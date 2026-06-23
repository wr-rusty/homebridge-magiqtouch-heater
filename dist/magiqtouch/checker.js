import { getHeater } from './models.js';
export const expectSystemOn = (on) => (status) => status.systemOn === on;
export const expectMode = (mode) => (status) => status.runningMode === mode;
export const expectHeaterSetTemp = (temp) => (status) => getHeater(status)?.set_temp === temp;
export const expectHeaterFanSpeed = (speed) => (status) => getHeater(status)?.fan_speed === speed;
/** Combine several checkers; all must pass. */
export const all = (...checkers) => (status) => checkers.every((c) => c(status));
//# sourceMappingURL=checker.js.map