import type { RemoteStatus, SystemDetails, UnitDetails } from '../../src/magiqtouch/models.js';

export function makeHeaterUnit(over: Partial<UnitDetails> = {}): UnitDetails {
  return {
    name: 'Heater',
    zoneType: 'NONE',
    zoneOn: true,
    set_temp: 22,
    temperature_units: 'c',
    actual_temp: 18,
    max_temp: 25,
    min_temp: 0,
    fan_speed: 5,
    max_fan_speed: 10,
    min_fan_speed: 1,
    control_mode: 'TEMP',
    control_mode_type: 'NONE',
    runningState: 'NOT_REQUIRED',
    zoneRunningState: 'NOT_REQUIRED',
    programMode: 'off',
    ...over,
  };
}

export function makeStatus(over: Partial<RemoteStatus> = {}): RemoteStatus {
  return {
    device: 'd43639ad76f8',
    timestamp: 1782208492270,
    online: true,
    systemOn: false,
    runningMode: 'HEAT',
    heaterFault: false,
    coolerFault: false,
    cooler: [],
    heater: [makeHeaterUnit()],
    fan: {},
    touchCount: 0,
    installed: { heater: true },
    ...over,
  };
}

export function makeSystemDetails(over: Partial<SystemDetails> = {}): SystemDetails {
  return {
    System: { Name: 'My Home', Address: '<redacted>' },
    Wifi_Module: { MacAddressId: 'D43639AD76F8' },
    Heater: { InSystem: true, MinimumTemperature: 0, MaximumTemperature: 25 },
    NoOfZoneControls: 0,
    WallController: { Firmware: '1.2.3' },
    ...over,
  };
}
