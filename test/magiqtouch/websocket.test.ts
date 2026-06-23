import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MagIQTouchWebSocket } from '../../src/magiqtouch/websocket.js';
import { expectSystemOn } from '../../src/magiqtouch/checker.js';
import { FakeWsServer } from '../helpers/fakeWsServer.js';
import { fakeWsFactory } from '../helpers/fakeWebSocket.js';
import { makeStatus } from '../helpers/fixtures.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const getToken = async () => 'tok';

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Real local ws server (real timers) — protocol behaviour
// ---------------------------------------------------------------------------
describe('MagIQTouchWebSocket (real server)', () => {
  let server: FakeWsServer;
  let ws: MagIQTouchWebSocket;

  beforeEach(async () => {
    Object.values(log).forEach((f) => f.mockReset());
  });

  afterEach(async () => {
    ws?.close();
    await server?.close();
  });

  function connect(mode: Parameters<typeof server.setMode>[0] = 'confirm') {
    server = new FakeWsServer(mode);
    return server.ready().then(() => {
      ws = new MagIQTouchWebSocket(getToken, 'MAC', log, { url: server.url });
    });
  }

  it('reads status', async () => {
    await connect('confirm');
    server.setStatus(makeStatus({ systemOn: true }));
    const status = await ws.requestStatus(2000);
    expect(status.systemOn).toBe(true);
  });

  it('confirms a command via the checker', async () => {
    await connect('confirm');
    const params = makeStatus({ systemOn: true });
    const confirmed = await ws.sendCommand(params, expectSystemOn(true), 2000);
    expect(confirmed.systemOn).toBe(true);
    expect(server.commands).toHaveLength(1);
  });

  it('ignores stale echoes and resolves on the fresh one', async () => {
    await connect('stale-then-fresh');
    const params = makeStatus({ systemOn: true });
    const confirmed = await ws.sendCommand(params, expectSystemOn(true), 2000);
    expect(confirmed.systemOn).toBe(true);
  });

  it('ignores malformed frames', async () => {
    await connect('malformed');
    const params = makeStatus({ systemOn: true });
    const confirmed = await ws.sendCommand(params, expectSystemOn(true), 2000);
    expect(confirmed.systemOn).toBe(true);
  });

  it('serialises queued ops (one in flight at a time)', async () => {
    await connect('confirm');
    const a = ws.requestStatus(2000);
    const b = ws.requestStatus(2000);
    await Promise.all([a, b]);
    // Both eventually completed against the single connection.
    expect(server.connections).toBe(1);
  });

  it('recovers a command via reconnect + retry-once (flaky first connection)', async () => {
    await connect('flaky-first');
    const params = makeStatus({ systemOn: true });
    // First connection never confirms -> op timeout -> recycle -> retry on conn #2.
    const confirmed = await ws.sendCommand(params, expectSystemOn(true), 300);
    expect(confirmed.systemOn).toBe(true);
    expect(server.connections).toBeGreaterThanOrEqual(2);
  });

  it('reconnects after the connection drops', async () => {
    await connect('confirm');
    await ws.requestStatus(2000);
    expect(server.connections).toBe(1);

    const reconnected = new Promise<void>((resolve) => ws.once('reconnected', () => resolve()));
    server.dropConnections(); // server-side drop -> client onClose -> backoff reconnect
    await reconnected;

    const status = await ws.requestStatus(2000);
    expect(status).toBeDefined();
    expect(server.connections).toBe(2);
  });

  it('close() rejects pending ops', async () => {
    server = new FakeWsServer('never');
    await server.ready();
    ws = new MagIQTouchWebSocket(getToken, 'MAC', log, { url: server.url });
    const p = ws.requestStatus(5000);
    await flush();
    ws.close();
    await expect(p).rejects.toThrow(/closed|timed out/);
  });
});

// ---------------------------------------------------------------------------
// Fake socket (fake timers) — reliability mechanics
// ---------------------------------------------------------------------------
describe('MagIQTouchWebSocket (fake socket)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(log).forEach((f) => f.mockReset());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects when send throws', async () => {
    const { factory, last } = fakeWsFactory();
    const ws = new MagIQTouchWebSocket(getToken, 'MAC', log, { url: 'ws://x?token=', wsFactory: factory });
    const p = ws.requestStatus(1000);
    p.catch(() => undefined); // attach a handler now so the later rejection isn't flagged
    await vi.advanceTimersByTimeAsync(1); // let getToken resolve + socket build
    const sock = last();
    sock.throwOnSend = true;
    sock.open();
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).rejects.toThrow(/send failed/);
    ws.close();
  });

  it('recycles a half-open connection via the liveness watchdog', async () => {
    const { factory, instances, last } = fakeWsFactory();
    const ws = new MagIQTouchWebSocket(getToken, 'MAC', log, {
      url: 'ws://x?token=',
      wsFactory: factory,
      pingIntervalMs: 1000,
      livenessTimeoutMs: 2500,
    });
    // Open a connection but never deliver any traffic (no pong, no message).
    const p = ws.requestStatus(60000);
    await vi.advanceTimersByTimeAsync(1);
    last().open();
    await vi.advanceTimersByTimeAsync(1);
    expect(instances).toHaveLength(1);

    // No traffic for > livenessTimeout -> watchdog terminates + reconnects.
    await vi.advanceTimersByTimeAsync(4000);
    expect(instances[0].terminated).toBe(true);
    await vi.advanceTimersByTimeAsync(2000); // backoff reconnect
    expect(instances.length).toBeGreaterThanOrEqual(2);
    ws.close();
    await p.catch(() => undefined);
  });

  it('sends keepalive pings while traffic is fresh', async () => {
    const { factory, last } = fakeWsFactory();
    const ws = new MagIQTouchWebSocket(getToken, 'MAC', log, {
      url: 'ws://x?token=',
      wsFactory: factory,
      pingIntervalMs: 1000,
      livenessTimeoutMs: 10000,
    });
    const p = ws.requestStatus(60000);
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1);
    const sock = last();
    sock.open();
    await vi.advanceTimersByTimeAsync(1);
    sock.receive(makeStatus()); // keeps lastMessageAt fresh
    await vi.advanceTimersByTimeAsync(3500); // ~3 ping intervals
    expect(sock.pings).toBeGreaterThanOrEqual(2);
    expect(sock.terminated).toBe(false);
    ws.close();
  });
});
