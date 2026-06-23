import type { PlatformConfig } from 'homebridge';
/**
 * Platform identifier — must match the `platform` value in config.json and the
 * `pluginAlias` in config.schema.json.
 */
export declare const PLATFORM_NAME = "MagIQTouch";
/**
 * The npm package name — must match `name` in package.json.
 */
export declare const PLUGIN_NAME = "homebridge-magiqtouch-heater";
/**
 * Strongly-typed view of the platform block in config.json.
 */
export interface MagIQTouchConfig extends PlatformConfig {
    email?: string;
    password?: string;
    /** Safety-net status poll interval in seconds. */
    pollInterval?: number;
    /** Expose the heater fan speed as a RotationSpeed slider on the tile. */
    exposeFan?: boolean;
    /** Expose a separate Fan tile for heater fan-only mode (HEATER_FAN). */
    exposeFanOnlyMode?: boolean;
    /** Verbose protocol logging. */
    debug?: boolean;
}
