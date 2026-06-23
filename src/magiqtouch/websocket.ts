import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

import type { Checker } from './checker.js';
import type { Logger } from './logger.js';
import type { RemoteStatus } from './models.js';

export const WEBSOCKET_URL =
  'https://xs5z2412cf.execute-api.ap-southeast-2.amazonaws.com/prod?token=';

const WS_HEADERS = { 'user-agent': 'Dart/3.2 (dart:io)' };
const SUBPROTOCOL = 'wasp';

/** Token in the URL is good for ~1h; reconnect well before that. */
const TOKEN_RECONNECT_MS = 40 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30000;
/** Send a keepalive ping this often to elicit traffic and keep the link warm. */
const DEFAULT_PING_INTERVAL_MS = 30000;
/**
 * If no frame (message OR pong) arrives within this window the connection is
 * treated as half-open and force-recycled. Must exceed the client's status
 * poll interval (default 60s) so a healthy-but-quiet link is not killed.
 */
const DEFAULT_LIVENESS_TIMEOUT_MS = 75000;

export type WsFactory = (
  url: string,
  protocols: string[],
  options: WebSocket.ClientOptions,
) => WebSocket;

export interface WebSocketOptions {
  /** Override the base URL (token is appended). Defaults to {@link WEBSOCKET_URL}. */
  url?: string;
  /** Override the WebSocket constructor (for tests). */
  wsFactory?: WsFactory;
  pingIntervalMs?: number;
  livenessTimeoutMs?: number;
}

interface PendingOp {
  message: string;
  checker: Checker;
  timeout: number;
  resolve: (status: RemoteStatus) => void;
  reject: (err: Error) => void;
  /** True once this op has already been retried on a fresh connection. */
  retried?: boolean;
}

/**
 * Holds a single websocket connection to the MagIQTouch cloud and serialises
 * status reads and commands over it. Each operation sends a message and waits
 * for an echoed {@link RemoteStatus} that satisfies its checker.
 *
 * Resilience: a ping keepalive plus a liveness watchdog detect a silently
 * half-open connection (common for cloud WebSockets behind load balancers) and
 * force-recycle it; an operation that times out terminates the socket and
 * retries once on a fresh connection.
 *
 * Emits:
 *   'status'      (status: RemoteStatus) — every status received, solicited or not.
 *   'reconnected'                        — a fresh connection was established after a drop.
 */
export class MagIQTouchWebSocket extends EventEmitter {
  private ws?: WebSocket;
  private connecting?: Promise<void>;
  private active?: PendingOp;
  private activeTimer?: NodeJS.Timeout;
  /** Guards against concurrent pump() runs racing across the connect await. */
  private starting = false;
  private readonly queue: PendingOp[] = [];
  private closed = false;
  private backoff = BACKOFF_MIN_MS;
  private tokenTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private keepaliveTimer?: NodeJS.Timeout;
  private lastMessageAt = 0;

  private readonly url: string;
  private readonly wsFactory: WsFactory;
  private readonly pingIntervalMs: number;
  private readonly livenessTimeoutMs: number;

  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly macAddress: string,
    private readonly log: Logger,
    opts: WebSocketOptions = {},
  ) {
    super();
    this.url = opts.url ?? WEBSOCKET_URL;
    this.wsFactory = opts.wsFactory ?? ((u, p, o) => new WebSocket(u, p, o));
    this.pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.livenessTimeoutMs = opts.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;
  }

  /** Request the latest status; resolves with the first status echoed back. */
  requestStatus(timeout = DEFAULT_TIMEOUT_MS): Promise<RemoteStatus> {
    const message = JSON.stringify({
      action: 'status',
      params: { device: this.macAddress },
    });
    return this.enqueue({ message, checker: () => true, timeout });
  }

  /**
   * Send a command (a full, mutated status payload) and resolve once an echoed
   * status satisfies `checker`.
   */
  sendCommand(
    params: RemoteStatus,
    checker: Checker,
    timeout = DEFAULT_TIMEOUT_MS,
  ): Promise<RemoteStatus> {
    const message = JSON.stringify({ action: 'command', params });
    return this.enqueue({ message, checker, timeout });
  }

  /** Close the connection and stop reconnecting. */
  close(): void {
    this.closed = true;
    this.clearTimers();
    const err = new Error('websocket closed');
    if (this.active) {
      this.active.reject(err);
      this.active = undefined;
    }
    while (this.queue.length) {
      this.queue.shift()!.reject(err);
    }
    this.detachSocket();
  }

  private enqueue(op: Omit<PendingOp, 'resolve' | 'reject'>): Promise<RemoteStatus> {
    return new Promise<RemoteStatus>((resolve, reject) => {
      this.queue.push({ ...op, resolve, reject });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.active || this.starting || this.queue.length === 0 || this.closed) {
      return;
    }
    this.starting = true;
    try {
      await this.ensureConnected();
    } catch (err) {
      // Connection failed: fail the head op; it can be retried by the caller.
      this.starting = false;
      const op = this.queue.shift();
      op?.reject(err as Error);
      void this.pump();
      return;
    }
    this.starting = false;

    // Re-check after the await: close() or a prior pump may have changed state.
    if (this.active || this.queue.length === 0 || this.closed) {
      return;
    }
    const op = this.queue.shift();
    if (!op) {
      return;
    }
    this.active = op;
    this.activeTimer = setTimeout(() => this.onOpTimeout(op), op.timeout);

    this.log.debug(`ws send: ${op.message}`);
    try {
      this.ws!.send(op.message);
    } catch (err) {
      clearTimeout(this.activeTimer);
      this.active = undefined;
      op.reject(err as Error);
      void this.pump();
    }
  }

  /**
   * An op did not get a confirming echo in time. The connection may be
   * half-open, so recycle it and retry the op once on a fresh socket before
   * giving up.
   */
  private onOpTimeout(op: PendingOp): void {
    if (this.active !== op) {
      return;
    }
    this.active = undefined;
    clearTimeout(this.activeTimer);

    if (!op.retried) {
      op.retried = true;
      this.log.debug(`op timed out after ${op.timeout}ms; recycling connection and retrying once`);
      this.forceReconnect();
      this.queue.unshift(op);
      void this.pump();
      return;
    }

    op.reject(new Error(`timed out after ${op.timeout}ms waiting for confirmation`));
    void this.pump();
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }
    this.connecting = this.openConnection().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async openConnection(): Promise<void> {
    const token = await this.getToken();
    await new Promise<void>((resolve, reject) => {
      const ws = this.wsFactory(this.url + token, [SUBPROTOCOL], { headers: WS_HEADERS });
      const onOpen = () => {
        ws.off('error', onError);
        this.ws = ws;
        this.backoff = BACKOFF_MIN_MS;
        this.lastMessageAt = Date.now();
        this.attachHandlers(ws);
        this.scheduleTokenReconnect();
        this.startKeepalive();
        this.log.debug('websocket connected');
        resolve();
      };
      const onError = (err: Error) => {
        ws.off('open', onOpen);
        reject(err);
      };
      ws.once('open', onOpen);
      ws.once('error', onError);
    });
  }

  private attachHandlers(ws: WebSocket): void {
    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('pong', () => {
      this.lastMessageAt = Date.now();
    });
    ws.on('close', (code) => this.onClose(code));
    ws.on('error', (err) => {
      this.log.debug(`websocket error: ${err.message}`);
      // 'close' will follow and drive reconnect.
    });
  }

  private onMessage(raw: string): void {
    this.lastMessageAt = Date.now();
    let status: RemoteStatus;
    try {
      status = JSON.parse(raw) as RemoteStatus;
    } catch {
      this.log.debug(`ws: ignoring non-JSON message: ${raw.slice(0, 200)}`);
      return;
    }

    // Always surface the latest state for the live feed.
    this.emit('status', status);

    if (this.active && this.active.checker(status)) {
      const op = this.active;
      this.active = undefined;
      clearTimeout(this.activeTimer);
      op.resolve(status);
      void this.pump();
    }
  }

  private onClose(code: number): void {
    this.log.debug(`websocket closed (code ${code})`);
    this.detachSocket();
    if (this.closed) {
      return;
    }
    // An in-flight op will time out (and retry) on its own; schedule a
    // reconnect so queued/future ops and the live feed recover.
    this.scheduleReconnect();
  }

  /**
   * Tear down the current socket without reconnecting and without letting its
   * late 'close' event clobber a replacement socket. Used by the liveness
   * watchdog and the op-timeout retry path.
   */
  private forceReconnect(): void {
    this.detachSocket();
  }

  private detachSocket(): void {
    this.stopKeepalive();
    this.clearTokenTimer();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = undefined;
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      if (Date.now() - this.lastMessageAt > this.livenessTimeoutMs) {
        this.log.debug('websocket appears half-open (no traffic); recycling');
        this.forceReconnect();
        this.scheduleReconnect();
        return;
      }
      try {
        this.ws.ping();
      } catch {
        // ignore — a dead socket surfaces via liveness timeout or send failure.
      }
    }, this.pingIntervalMs);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) {
      return;
    }
    const delay = Math.min(this.backoff, BACKOFF_MAX_MS);
    const jitter = Math.floor(Math.random() * 500);
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensureConnected()
        .then(() => {
          this.emit('reconnected');
          void this.pump();
        })
        .catch((err) => {
          this.log.debug(`reconnect failed: ${(err as Error).message}`);
          this.scheduleReconnect();
        });
    }, delay + jitter);
  }

  private scheduleTokenReconnect(): void {
    this.clearTokenTimer();
    this.tokenTimer = setTimeout(() => {
      this.log.debug('cycling websocket to refresh auth token');
      // Recycle to reconnect with a fresh token.
      this.forceReconnect();
      this.scheduleReconnect();
    }, TOKEN_RECONNECT_MS);
  }

  private clearTokenTimer(): void {
    if (this.tokenTimer) {
      clearTimeout(this.tokenTimer);
      this.tokenTimer = undefined;
    }
  }

  private clearTimers(): void {
    this.clearTokenTimer();
    this.stopKeepalive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = undefined;
    }
  }
}
