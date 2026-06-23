import { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

import type { RemoteStatus } from '../../src/magiqtouch/models.js';
import { makeStatus } from './fixtures.js';

export type FakeMode =
  | 'confirm' // echo the mutated command params (and reply to status)
  | 'never' // never reply to anything
  | 'stale-then-fresh' // reply with old status first, then the mutated echo
  | 'drop' // close the connection on first message
  | 'flaky-first' // first connection never replies; later connections confirm
  | 'status-only' // reply to status, ignore commands (command never confirms)
  | 'malformed'; // reply with a non-JSON frame, then a valid one

/**
 * A real local WebSocket server that mimics the MagIQTouch cloud protocol so
 * the `ws`-based client can be exercised end-to-end without the internet.
 */
export class FakeWsServer {
  private readonly wss: WebSocketServer;
  private current: RemoteStatus;
  /** Command payloads received from the client (for assertions). */
  readonly commands: RemoteStatus[] = [];
  connections = 0;
  private readyPromise: Promise<void>;

  constructor(
    private mode: FakeMode = 'confirm',
    initial: RemoteStatus = makeStatus({ systemOn: true }),
  ) {
    this.current = initial;
    this.wss = new WebSocketServer({ port: 0, handleProtocols: () => 'wasp' });
    this.readyPromise = new Promise((resolve) => this.wss.once('listening', () => resolve()));
    this.wss.on('connection', (ws) => this.onConnection(ws));
  }

  async ready(): Promise<void> {
    return this.readyPromise;
  }

  get url(): string {
    const port = (this.wss.address() as AddressInfo).port;
    // Client appends the token after this base.
    return `ws://127.0.0.1:${port}?token=`;
  }

  setStatus(status: RemoteStatus): void {
    this.current = status;
  }

  setMode(mode: FakeMode): void {
    this.mode = mode;
  }

  /** Terminate all current client connections (simulates a server-side drop). */
  dropConnections(): void {
    for (const c of this.wss.clients) {
      c.terminate();
    }
  }

  close(): Promise<void> {
    for (const c of this.wss.clients) {
      c.terminate();
    }
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }

  private onConnection(ws: WebSocket): void {
    const connIndex = this.connections;
    this.connections += 1;

    ws.on('message', (raw) => {
      let msg: { action: string; params: RemoteStatus };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (this.mode === 'drop') {
        ws.close();
        return;
      }
      if (this.mode === 'never') {
        return;
      }
      if (this.mode === 'flaky-first' && connIndex === 0) {
        return; // force the client's op timeout + reconnect
      }

      if (msg.action === 'status') {
        ws.send(JSON.stringify(this.current));
        return;
      }

      if (msg.action === 'command') {
        this.commands.push(msg.params);
        if (this.mode === 'status-only') {
          return; // never confirm the command
        }
        // Adopt the commanded state so the echo satisfies the client's checker.
        this.current = msg.params;

        if (this.mode === 'malformed') {
          ws.send('<<not json>>');
          ws.send(JSON.stringify(this.current));
          return;
        }
        if (this.mode === 'stale-then-fresh') {
          // First an unchanged/old echo (checker fails), then the fresh one.
          ws.send(JSON.stringify(makeStatus({ systemOn: false, timestamp: 1 })));
          setTimeout(() => ws.send(JSON.stringify(this.current)), 10);
          return;
        }
        ws.send(JSON.stringify(this.current));
      }
    });
  }
}
