/**
 * Typed model of the MagIQTouch cloud protocol payloads.
 *
 * Reverse-engineered from the Home Assistant integration `andrewleech/ha_magiqtouch`.
 * We parse the full payload for robustness/forward-compat, but only the heater
 * path is acted on by this plugin.
 */
export const RUNNING_STATE_REQUIRED = 'REQUIRED_RUNNING';
export const RUNNING_STATE_IDLE = 'NOT_REQUIRED';
/**
 * The first heater unit in the status, or undefined if the payload has none yet.
 * This system is single-zone, so there is at most one entry of interest.
 */
export function getHeater(status) {
    return status?.heater?.[0];
}
/** True if the heater unit is actively firing (not merely powered on). */
export function isHeaterRunning(unit) {
    return unit?.runningState === RUNNING_STATE_REQUIRED;
}
/**
 * Convert a unit temperature to Celsius (HomeKit's internal unit).
 * MagIQTouch heaters in AU report Celsius, but guard against Fahrenheit configs.
 */
export function unitTempToCelsius(value, units) {
    if (units && units.toLowerCase() === 'f') {
        return (value - 32) * (5 / 9);
    }
    return value;
}
/** Convert a Celsius value (from HomeKit) into the unit's native temperature. */
export function celsiusToUnitTemp(celsius, units) {
    if (units && units.toLowerCase() === 'f') {
        return celsius * (9 / 5) + 32;
    }
    return celsius;
}
//# sourceMappingURL=models.js.map