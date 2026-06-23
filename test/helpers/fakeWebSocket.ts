import { EventEmitter } from 'node:events';

import type { WsFactory } from '../../src/magiqtouch/websocket.js';

/**
 * A controllable fake WebSocket (no real I/O) for timer-driven reliability
 * tests. Mirrors the small surface `websocket.ts` uses: readyState, send, ping,
 * terminate, close, and the 'open'/'message'/'pong'/'close'/'error' events.
 */
export class FakeWebSocket extends EventEmitter {
  readyState = 0; // CONNECTING; ws.WebSocket.OPEN === 1
  readonly sent: string[] = [];
  pings = 0;
  terminated = false;
  throwOnSend = false;

  constructor(
    readonly url: string,
    readonly protocols: string[],
    readonly options: unknown,
  ) {
    super();
  }

  send(data: string): void {
    if (this.throwOnSend) {
      throw new Error('send failed');
    }
    this.sent.push(String(data));
  }

  ping(): void {
    this.pings += 1;
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
  }

  close(): void {
    this.readyState = 3;
    this.emit('close', 1000);
  }

  // --- test controls ---
  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  receive(payload: unknown): void {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.emit('message', Buffer.from(raw));
  }

  pong(): void {
    this.emit('pong');
  }

  drop(code = 1006): void {
    this.readyState = 3;
    this.emit('close', code);
  }

  failWith(err: Error): void {
    this.emit('error', err);
  }
}

/** Build a `WsFactory` that records every socket it creates. */
export function fakeWsFactory(): { factory: WsFactory; instances: FakeWebSocket[]; last(): FakeWebSocket } {
  const instances: FakeWebSocket[] = [];
  const factory: WsFactory = (url, protocols, options) => {
    const ws = new FakeWebSocket(url, protocols, options);
    instances.push(ws);
    return ws as unknown as ReturnType<WsFactory>;
  };
  return { factory, instances, last: () => instances[instances.length - 1] };
}
