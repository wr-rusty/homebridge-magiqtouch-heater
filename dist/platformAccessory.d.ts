import type { PlatformAccessory } from 'homebridge';
import type { MagIQTouchPlatform } from './platform.js';
import type { MagIQTouchClient } from './magiqtouch/client.js';
/**
 * A single HEAT-only HeaterCooler accessory representing the gas heater:
 * on/off + current/target temperature. Fan speed (RotationSpeed on the tile)
 * and a separate fan-only Fan tile are opt-in via config.
 */
export declare class MagIQTouchHeaterAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly client;
    private readonly service;
    private readonly fanService?;
    private readonly C;
    private readonly exposeFan;
    private readonly exposeFanOnlyMode;
    private pendingActive?;
    private pendingTemp?;
    private pendingFanSpeed?;
    private pendingFanOnly?;
    private flushTimer?;
    constructor(platform: MagIQTouchPlatform, accessory: PlatformAccessory, client: MagIQTouchClient);
    private maxFanSpeed;
    /**
     * Wrap an onGet computation so that, once the device has reported itself
     * offline, HomeKit shows "No Response" instead of a stale value.
     */
    private guard;
    private getActive;
    private getCurrentState;
    private getCurrentTemperature;
    private getTargetTemperature;
    private getFanSpeedPercent;
    private getFanOnlyActive;
    private setActive;
    private setTargetTemperature;
    private setFanSpeedPercent;
    private setFanOnlyActive;
    private scheduleFlush;
    private flush;
    private pushStatus;
    private applyStatus;
}
