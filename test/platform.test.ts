import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Characteristic, Service } from 'hap-nodejs';

const h = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  refreshStatus: vi.fn(),
}));

vi.mock('../src/magiqtouch/client.js', async () => {
  const { EventEmitter: EE } = await import('node:events');
  class MagIQTouchClient extends EE {
    start = h.start;
    stop = h.stop;
    refreshStatus = h.refreshStatus;
    system = { System: { Name: 'My Home' }, Wifi_Module: { MacAddressId: 'MAC' } };
    status = undefined;
  }
  return { MagIQTouchClient };
});

vi.mock('../src/platformAccessory.js', () => ({
  MagIQTouchHeaterAccessory: class {},
}));

import { MagIQTouchPlatform } from '../src/platform.js';
import { AuthError } from '../src/magiqtouch/cognito.js';
import type { API, Logging } from 'homebridge';
import type { MagIQTouchConfig } from '../src/settings.js';

function makeApi() {
  const api = new EventEmitter() as unknown as API & EventEmitter;
  Object.assign(api, {
    hap: {
      Service,
      Characteristic,
      uuid: { generate: (s: string) => `uuid-${s}` },
    },
    platformAccessory: class {
      services: unknown[] = [];
      constructor(public displayName: string, public UUID: string) {}
    },
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
  });
  return api;
}

function makeLog(): Logging {
  const fn = vi.fn() as unknown as Logging;
  Object.assign(fn, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
  return fn;
}

const baseConfig: MagIQTouchConfig = {
  platform: 'MagIQTouch',
  name: 'MagIQTouch',
  email: 'a@b.com',
  password: 'pw',
};

beforeEach(() => {
  vi.useFakeTimers();
  h.start.mockReset().mockResolvedValue(undefined);
  h.stop.mockReset().mockResolvedValue(undefined);
  h.refreshStatus.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MagIQTouchPlatform', () => {
  it('does not start or register without credentials', async () => {
    const api = makeApi();
    const log = makeLog();
    new MagIQTouchPlatform(log, { platform: 'MagIQTouch', name: 'MagIQTouch' }, api);
    api.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(1);
    expect(log.error).toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  it('registers an accessory and starts polling on success', async () => {
    const api = makeApi();
    const log = makeLog();
    new MagIQTouchPlatform(log, baseConfig, api);
    api.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.refreshStatus).toHaveBeenCalled();
  });

  it('retries after 15 minutes on an auth error (not 60s)', async () => {
    const api = makeApi();
    const log = makeLog();
    h.start.mockRejectedValueOnce(new AuthError('bad')).mockResolvedValue(undefined);
    new MagIQTouchPlatform(log, baseConfig, api);
    api.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.start).toHaveBeenCalledTimes(1); // not the transient 60s path

    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(h.start).toHaveBeenCalledTimes(2);
  });

  it('retries after 60s on a transient error', async () => {
    const api = makeApi();
    const log = makeLog();
    h.start.mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    new MagIQTouchPlatform(log, baseConfig, api);
    api.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.start).toHaveBeenCalledTimes(2);
  });

  it('clamps the poll interval to a 15s floor', async () => {
    const api = makeApi();
    const log = makeLog();
    new MagIQTouchPlatform(log, { ...baseConfig, pollInterval: 5 }, api);
    api.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(h.refreshStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.refreshStatus).toHaveBeenCalledTimes(1);
  });

  it('shuts down: stops the client and the poll timer', async () => {
    const api = makeApi();
    const log = makeLog();
    new MagIQTouchPlatform(log, baseConfig, api);
    api.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(1);
    api.emit('shutdown');
    expect(h.stop).toHaveBeenCalled();
    h.refreshStatus.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.refreshStatus).not.toHaveBeenCalled();
  });
});
