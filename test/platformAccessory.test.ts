import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Characteristic, Service } from 'hap-nodejs';

import { MagIQTouchHeaterAccessory } from '../src/platformAccessory.js';
import type { MagIQTouchPlatform } from '../src/platform.js';
import { makeHeaterUnit, makeStatus } from './helpers/fixtures.js';
import { FakeClient, makeAccessory, makePlatform } from './helpers/hap.js';

const C = Characteristic;

function build(config = {}) {
  const platform = makePlatform(config);
  const accessory = makeAccessory();
  const client = new FakeClient();
  const acc = new MagIQTouchHeaterAccessory(
    platform as unknown as MagIQTouchPlatform,
    accessory as never,
    client.asClient(),
  );
  const hc = accessory.getService(Service.HeaterCooler)!;
  return { platform, accessory, client, acc, hc };
}

describe('MagIQTouchHeaterAccessory mapping', () => {
  it('maps systemOn -> Active', () => {
    const { client, hc } = build();
    client.push(makeStatus({ systemOn: true }));
    expect(hc.getCharacteristic(C.Active).value).toBe(C.Active.ACTIVE);
    client.push(makeStatus({ systemOn: false }));
    expect(hc.getCharacteristic(C.Active).value).toBe(C.Active.INACTIVE);
  });

  it('maps current state INACTIVE / IDLE / HEATING', () => {
    const { client, hc } = build();
    client.push(makeStatus({ systemOn: false }));
    expect(hc.getCharacteristic(C.CurrentHeaterCoolerState).value).toBe(
      C.CurrentHeaterCoolerState.INACTIVE,
    );
    client.push(makeStatus({ systemOn: true, heater: [makeHeaterUnit({ runningState: 'NOT_REQUIRED' })] }));
    expect(hc.getCharacteristic(C.CurrentHeaterCoolerState).value).toBe(
      C.CurrentHeaterCoolerState.IDLE,
    );
    client.push(makeStatus({ systemOn: true, heater: [makeHeaterUnit({ runningState: 'REQUIRED_RUNNING' })] }));
    expect(hc.getCharacteristic(C.CurrentHeaterCoolerState).value).toBe(
      C.CurrentHeaterCoolerState.HEATING,
    );
  });

  it('maps temperatures and fault', () => {
    const { client, hc } = build();
    client.push(makeStatus({
      systemOn: true,
      heaterFault: true,
      heater: [makeHeaterUnit({ actual_temp: 19, set_temp: 24 })],
    }));
    expect(hc.getCharacteristic(C.CurrentTemperature).value).toBe(19);
    expect(hc.getCharacteristic(C.HeatingThresholdTemperature).value).toBe(24);
    expect(hc.getCharacteristic(C.StatusFault).value).toBe(C.StatusFault.GENERAL_FAULT);
  });

  it('converts Fahrenheit readings to Celsius', () => {
    const { client, hc } = build();
    client.push(makeStatus({
      systemOn: true,
      heater: [makeHeaterUnit({ temperature_units: 'f', actual_temp: 68, set_temp: 72 })],
    }));
    expect(hc.getCharacteristic(C.CurrentTemperature).value).toBeCloseTo(20, 0);
    expect(hc.getCharacteristic(C.HeatingThresholdTemperature).value).toBeCloseTo(22.2, 0);
  });

  it('restricts TargetHeaterCoolerState to HEAT', () => {
    const { hc } = build();
    const props = hc.getCharacteristic(C.TargetHeaterCoolerState).props;
    expect(props.validValues).toEqual([C.TargetHeaterCoolerState.HEAT]);
  });

  it('omits fan characteristics by default and adds them when enabled', () => {
    const off = build();
    expect(off.hc.testCharacteristic(C.RotationSpeed)).toBe(false);
    expect(off.accessory.getServiceById(Service.Fanv2, 'fan-only')).toBeUndefined();

    const on = build({ exposeFan: true, exposeFanOnlyMode: true });
    expect(on.hc.testCharacteristic(C.RotationSpeed)).toBe(true);
    expect(on.accessory.getServiceById(Service.Fanv2, 'fan-only')).toBeDefined();
  });

  it('maps fan speed to RotationSpeed percent when exposed', () => {
    const { client, hc } = build({ exposeFan: true });
    client.push(makeStatus({ systemOn: true, heater: [makeHeaterUnit({ fan_speed: 5, max_fan_speed: 10 })] }));
    expect(hc.getCharacteristic(C.RotationSpeed).value).toBe(50);
  });
});

describe('MagIQTouchHeaterAccessory setters', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces rapid setters into a single flush with the latest values', async () => {
    const { client, hc } = build();
    client.push(makeStatus({ systemOn: false }));

    // Simulate rapid HomeKit writes within the debounce window.
    await hc.getCharacteristic(C.Active).handleSetRequest(C.Active.ACTIVE);
    await hc.getCharacteristic(C.HeatingThresholdTemperature).handleSetRequest(21);
    await hc.getCharacteristic(C.HeatingThresholdTemperature).handleSetRequest(23);

    await vi.advanceTimersByTimeAsync(500);

    expect(client.setSystemOn).toHaveBeenCalledTimes(1);
    expect(client.setSystemOn).toHaveBeenCalledWith(true);
    expect(client.setTargetTemperature).toHaveBeenCalledTimes(1);
    expect(client.setTargetTemperature).toHaveBeenCalledWith(23);
  });

  it('reports No Response (HapStatusError) once the device is offline', async () => {
    vi.useRealTimers();
    const { client, hc } = build();
    client.push(makeStatus({ systemOn: true })); // online first
    client.push(makeStatus({ systemOn: true, online: false }));
    await expect(hc.getCharacteristic(C.CurrentTemperature).handleGetRequest()).rejects.toBeDefined();
  });

  it('reverts to device state when a command fails', async () => {
    const { client, hc } = build();
    client.push(makeStatus({ systemOn: false }));
    client.setSystemOn.mockRejectedValueOnce(new Error('boom'));

    await hc.getCharacteristic(C.Active).handleSetRequest(C.Active.ACTIVE);
    await vi.advanceTimersByTimeAsync(500);

    // After the failure, Active reflects the (unchanged) device state.
    expect(hc.getCharacteristic(C.Active).value).toBe(C.Active.INACTIVE);
  });
});
