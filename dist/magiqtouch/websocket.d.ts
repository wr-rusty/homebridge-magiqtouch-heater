import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { Checker } from './checker.js';
import type { Logger } from './logger.js';
import type { RemoteStatus } from './models.js';
export declare const WEBSOCKET_URL = "https://xs5z2412cf.execute-api.ap-southeast-2.amazonaws.com/prod?token=";
export type WsFactory = (url: string, protocols: string[], options: WebSocket.ClientOptions) => WebSocket;
export interface WebSocketOptions {
    /** Override the base URL (token is appended). Defaults to {@link WEBSOCKET_URL}. */
    url?: string;
    /** Override the WebSocket constructor (for tests). */
    wsFactory?: WsFactory;
    pingIntervalMs?: number;
    livenessTimeoutMs?: number;
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
export declare class MagIQTouchWebSocket extends EventEmitter {
    private readonly getToken;
    private readonly macAddress;
    private readonly log;
    private ws?;
    private connecting?;
    private active?;
    private activeTimer?;
    /** Guards against concurrent pump() runs racing across the connect await. */
    private starting;
    private readonly queue;
    private closed;
    private backoff;
    private tokenTimer?;
    private reconnectTimer?;
    private keepaliveTimer?;
    private lastMessageAt;
    private readonly url;
    private readonly wsFactory;
    private readonly pingIntervalMs;
    private readonly livenessTimeoutMs;
    constructor(getToken: () => Promise<string>, macAddress: string, log: Logger, opts?: WebSocketOptions);
    /** Request the latest status; resolves with the first status echoed back. */
    requestStatus(timeout?: number): Promise<RemoteStatus>;
    /**
     * Send a command (a full, mutated status payload) and resolve once an echoed
     * status satisfies `checker`.
     */
    sendCommand(params: RemoteStatus, checker: Checker, timeout?: number): Promise<RemoteStatus>;
    /** Close the connection and stop reconnecting. */
    close(): void;
    private enqueue;
    private pump;
    /**
     * An op did not get a confirming echo in time. The connection may be
     * half-open, so recycle it and retry the op once on a fresh socket before
     * giving up.
     */
    private onOpTimeout;
    private ensureConnected;
    private openConnection;
    private attachHandlers;
    private onMessage;
    private onClose;
    /**
     * Tear down the current socket without reconnecting and without letting its
     * late 'close' event clobber a replacement socket. Used by the liveness
     * watchdog and the op-timeout retry path.
     */
    private forceReconnect;
    private detachSocket;
    private startKeepalive;
    private stopKeepalive;
    private scheduleReconnect;
    private scheduleTokenReconnect;
    private clearTokenTimer;
    private clearTimers;
}
