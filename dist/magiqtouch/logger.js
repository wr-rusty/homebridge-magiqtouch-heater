/** A console-backed logger for the standalone CLI harness. */
export const consoleLogger = {
    info: (m, ...p) => console.log(m, ...p),
    warn: (m, ...p) => console.warn(m, ...p),
    error: (m, ...p) => console.error(m, ...p),
    debug: (m, ...p) => console.debug(m, ...p),
};
//# sourceMappingURL=logger.js.map