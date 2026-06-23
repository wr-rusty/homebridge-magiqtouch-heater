import { getHeater, type RemoteStatus } from './models.js';

/**
 * A predicate that decides whether an echoed status confirms a command.
 * The websocket layer keeps reading echoes until one of these returns true.
 */
export type Checker = (status: RemoteStatus) => boolean;

export const expectSystemOn = (on: boolean): Checker =>
  (status) => status.systemOn === on;

export const expectMode = (mode: RemoteStatus['runningMode']): Checker =>
  (status) => status.runningMode === mode;

export const expectHeaterSetTemp = (temp: number): Checker =>
  (status) => getHeater(status)?.set_temp === temp;

export const expectHeaterFanSpeed = (speed: number): Checker =>
  (status) => getHeater(status)?.fan_speed === speed;

/** Combine several checkers; all must pass. */
export const all = (...checkers: Checker[]): Checker =>
  (status) => checkers.every((c) => c(status));
