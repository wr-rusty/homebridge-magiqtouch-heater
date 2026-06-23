import { describe, expect, it } from 'vitest';

import {
  celsiusToUnitTemp,
  getHeater,
  isHeaterRunning,
  unitTempToCelsius,
} from '../../src/magiqtouch/models.js';
import {
  all,
  expectHeaterFanSpeed,
  expectHeaterSetTemp,
  expectMode,
  expectSystemOn,
} from '../../src/magiqtouch/checker.js';
import { makeHeaterUnit, makeStatus } from '../helpers/fixtures.js';

describe('temperature conversion', () => {
  it('passes Celsius through unchanged', () => {
    expect(unitTempToCelsius(22, 'c')).toBe(22);
    expect(celsiusToUnitTemp(22, 'c')).toBe(22);
  });

  it('converts Fahrenheit both ways', () => {
    expect(unitTempToCelsius(212, 'f')).toBeCloseTo(100);
    expect(celsiusToUnitTemp(100, 'f')).toBeCloseTo(212);
  });
});

describe('heater selectors', () => {
  it('returns the first heater unit', () => {
    expect(getHeater(makeStatus())?.name).toBe('Heater');
  });

  it('detects an actively firing heater', () => {
    expect(isHeaterRunning(makeHeaterUnit({ runningState: 'REQUIRED_RUNNING' }))).toBe(true);
    expect(isHeaterRunning(makeHeaterUnit({ runningState: 'NOT_REQUIRED' }))).toBe(false);
    expect(isHeaterRunning(undefined)).toBe(false);
  });
});

describe('command checkers', () => {
  it('confirms system on/off', () => {
    expect(expectSystemOn(true)(makeStatus({ systemOn: true }))).toBe(true);
    expect(expectSystemOn(false)(makeStatus({ systemOn: true }))).toBe(false);
  });

  it('confirms running mode', () => {
    expect(expectMode('HEAT')(makeStatus({ runningMode: 'HEAT' }))).toBe(true);
    expect(expectMode('HEATER_FAN')(makeStatus({ runningMode: 'HEAT' }))).toBe(false);
  });

  it('confirms heater set temperature', () => {
    expect(expectHeaterSetTemp(24)(makeStatus({ heater: [makeHeaterUnit({ set_temp: 24 })] }))).toBe(true);
    expect(expectHeaterSetTemp(24)(makeStatus())).toBe(false);
  });

  it('confirms heater fan speed', () => {
    expect(expectHeaterFanSpeed(7)(makeStatus({ heater: [makeHeaterUnit({ fan_speed: 7 })] }))).toBe(true);
    expect(expectHeaterFanSpeed(7)(makeStatus())).toBe(false);
  });

  it('composes checkers with all()', () => {
    const ok = all(expectSystemOn(true), expectMode('HEAT'));
    expect(ok(makeStatus({ systemOn: true, runningMode: 'HEAT' }))).toBe(true);
    expect(ok(makeStatus({ systemOn: true, runningMode: 'HEATER_FAN' }))).toBe(false);
  });
});
