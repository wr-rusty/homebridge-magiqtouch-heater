/**
 * Typed model of the MagIQTouch cloud protocol payloads.
 *
 * Reverse-engineered from the Home Assistant integration `andrewleech/ha_magiqtouch`.
 * We parse the full payload for robustness/forward-compat, but only the heater
 * path is acted on by this plugin.
 */
export type RunningMode = 'HEAT' | 'HEATER_FAN' | 'COOL' | 'COOLER_FAN' | '';
export type ControlMode = 'TEMP' | 'FAN' | '';
export type TemperatureUnit = 'c' | 'f' | 'C' | 'F' | '';
/** A heater/cooler unit within the live status payload. */
export interface UnitDetails {
    name: string;
    zoneType: string;
    zoneOn: boolean;
    set_temp: number;
    temperature_units: TemperatureUnit;
    actual_temp: number;
    max_temp: number;
    min_temp: number;
    fan_speed: number;
    max_fan_speed: number;
    min_fan_speed: number;
    control_mode: ControlMode;
    control_mode_type: string;
    runningState: string;
    zoneRunningState: string;
    programMode: string;
}
export interface FanState {
    cooler_available: boolean;
    heater_available: boolean;
    heater_Fan_Speed: number;
    cooler_Fan_Speed: number;
}
export interface InstalledState {
    evap: boolean;
    faoc: boolean;
    heater: boolean;
    iaoc: boolean;
    coolerType: number;
}
/** Live state of the system, received over the websocket. */
export interface RemoteStatus {
    device: string;
    timestamp: number;
    online: boolean;
    systemOn: boolean;
    runningMode: RunningMode;
    heaterFault: boolean;
    coolerFault: boolean;
    cooler: UnitDetails[];
    heater: UnitDetails[];
    fan: Partial<FanState>;
    touchCount: number;
    installed: Partial<InstalledState>;
}
/** Static system configuration, from the REST `devices/system` endpoint. */
export interface SystemDetails {
    System?: {
        Name?: string;
        Address?: string;
    };
    Wifi_Module?: {
        MacAddressId?: string;
        version?: string;
        type?: string;
    };
    Heater?: {
        InSystem?: boolean;
        MinimumTemperature?: number;
        MaximumTemperature?: number;
        MaxSetFanSpeed?: number;
        ModelNo?: string;
    };
    EVAPCooler?: Record<string, unknown>;
    AOCFixed?: Record<string, unknown>;
    AOCInverter?: Record<string, unknown>;
    ACZones?: {
        Zones?: Array<{
            Name: string;
            Type: string;
        }>;
    };
    NoOfZoneControls?: number;
    WallController?: {
        Firmware?: string;
        Type?: number;
    };
}
export declare const RUNNING_STATE_REQUIRED = "REQUIRED_RUNNING";
export declare const RUNNING_STATE_IDLE = "NOT_REQUIRED";
/**
 * The first heater unit in the status, or undefined if the payload has none yet.
 * This system is single-zone, so there is at most one entry of interest.
 */
export declare function getHeater(status: RemoteStatus | undefined): UnitDetails | undefined;
/** True if the heater unit is actively firing (not merely powered on). */
export declare function isHeaterRunning(unit: UnitDetails | undefined): boolean;
/**
 * Convert a unit temperature to Celsius (HomeKit's internal unit).
 * MagIQTouch heaters in AU report Celsius, but guard against Fahrenheit configs.
 */
export declare function unitTempToCelsius(value: number, units: TemperatureUnit): number;
/** Convert a Celsius value (from HomeKit) into the unit's native temperature. */
export declare function celsiusToUnitTemp(celsius: number, units: TemperatureUnit): number;
