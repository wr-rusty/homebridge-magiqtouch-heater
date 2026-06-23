/**
 * Minimal logger interface so the client modules don't depend on Homebridge.
 * Homebridge's `Logger` satisfies this; the CLI harness supplies a console shim.
 */
export interface Logger {
  info(message: string, ...params: unknown[]): void;
  warn(message: string, ...params: unknown[]): void;
  error(message: string, ...params: unknown[]): void;
  debug(message: string, ...params: unknown[]): void;
}

/** A console-backed logger for the standalone CLI harness. */
export const consoleLogger: Logger = {
  info: (m, ...p) => console.log(m, ...p),
  warn: (m, ...p) => console.warn(m, ...p),
  error: (m, ...p) => console.error(m, ...p),
  debug: (m, ...p) => console.debug(m, ...p),
};
