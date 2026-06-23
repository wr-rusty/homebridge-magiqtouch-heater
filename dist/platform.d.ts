import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, Service } from 'homebridge';
import { type MagIQTouchConfig } from './settings.js';
import { MagIQTouchClient } from './magiqtouch/client.js';
export declare class MagIQTouchPlatform implements DynamicPlatformPlugin {
    readonly log: Logging;
    readonly config: MagIQTouchConfig;
    readonly api: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    /** Accessories restored from Homebridge's cache on launch. */
    readonly cachedAccessories: PlatformAccessory[];
    readonly client?: MagIQTouchClient;
    private pollTimer?;
    private readonly pollIntervalMs;
    constructor(log: Logging, config: MagIQTouchConfig, api: API);
    /** Called by Homebridge for each cached accessory during startup. */
    configureAccessory(accessory: PlatformAccessory): void;
    private startClient;
    private setupHeaterAccessory;
    private startPolling;
    private shutdown;
}
