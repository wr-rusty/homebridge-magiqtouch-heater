import { EventEmitter } from 'node:events';
import { Accessory, Characteristic, HAPStatus, HapStatusError, Service, uuid } from 'hap-nodejs';
import { vi } from 'vitest';

import type { MagIQTouchClient } from '../../src/magiqtouch/client.js';
import type { MagIQTouchConfig } from '../../src/settings.js';
import { makeSystemDetails } from './fixtures.js';
import type { RemoteStatus, SystemDetails } from '../../src/magiqtouch/models.js';

/** A platform double exposing the bits MagIQTouchHeaterAccessory uses. */
export function makePlatform(config: Partial<MagIQTouchConfig> = {}) {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    Service,
    Characteristic,
    config: { platform: 'MagIQTouch', name: 'MagIQTouch', ...config },
    log,
    api: { hap: { HapStatusError, HAPStatus } },
  };
}

/** A hap-nodejs Accessory standing in for a Homebridge PlatformAccessory. */
export function makeAccessory(name = 'MagIQTouch'): Accessory {
  const acc = new Accessory(name, uuid.generate(`test-${name}`));
  return acc;
}

/** A fake client: EventEmitter + status/system getters + spied control methods. */
export class FakeClient extends EventEmitter {
  status?: RemoteStatus;
  system: SystemDetails = makeSystemDetails();
  setSystemOn = vi.fn(async () => undefined);
  setHeating = vi.fn(async () => undefined);
  setTargetTemperature = vi.fn(async () => undefined);
  setFanSpeed = vi.fn(async () => undefined);
  setFanOnly = vi.fn(async () => undefined);

  push(status: RemoteStatus): void {
    this.status = status;
    this.emit('status', status);
  }

  asClient(): MagIQTouchClient {
    return this as unknown as MagIQTouchClient;
  }
}
