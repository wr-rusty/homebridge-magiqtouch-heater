import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { MagIQTouchClient } from './magiqtouch/client.js';
import { AuthError } from './magiqtouch/cognito.js';
import { MagIQTouchHeaterAccessory } from './platformAccessory.js';
/** Backoff before retrying after an auth failure — avoid Cognito lockout. */
const AUTH_RETRY_MS = 15 * 60 * 1000;
const START_RETRY_MS = 60 * 1000;
export class MagIQTouchPlatform {
    log;
    config;
    api;
    Service;
    Characteristic;
    /** Accessories restored from Homebridge's cache on launch. */
    cachedAccessories = [];
    client;
    pollTimer;
    pollIntervalMs;
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.pollIntervalMs = Math.max(15, this.config.pollInterval ?? 60) * 1000;
        if (!this.config.email || !this.config.password) {
            this.log.error('Missing "email" / "password" in config — MagIQTouch will not start.');
            return;
        }
        this.client = new MagIQTouchClient(this.config.email, this.config.password, this.log);
        this.api.on('didFinishLaunching', () => void this.startClient());
        this.api.on('shutdown', () => this.shutdown());
    }
    /** Called by Homebridge for each cached accessory during startup. */
    configureAccessory(accessory) {
        this.log.debug(`Restoring cached accessory: ${accessory.displayName}`);
        this.cachedAccessories.push(accessory);
    }
    async startClient() {
        if (!this.client) {
            return;
        }
        try {
            await this.client.start();
            this.setupHeaterAccessory();
            this.startPolling();
            this.log.info('MagIQTouch connected.');
            this.client.on('connectionError', (err) => this.log.debug(`connection issue (will recover): ${err.message}`));
        }
        catch (err) {
            if (err instanceof AuthError) {
                this.log.error(`MagIQTouch login failed — check email/password. Retrying in 15 min. (${err.message})`);
                setTimeout(() => void this.startClient(), AUTH_RETRY_MS);
            }
            else {
                this.log.warn(`MagIQTouch start failed, retrying in 60s: ${err.message}`);
                setTimeout(() => void this.startClient(), START_RETRY_MS);
            }
        }
    }
    setupHeaterAccessory() {
        const client = this.client;
        const sys = client.system;
        const mac = sys.Wifi_Module?.MacAddressId ?? 'unknown';
        const uuid = this.api.hap.uuid.generate(`magiqtouch-${mac}`);
        let accessory = this.cachedAccessories.find((a) => a.UUID === uuid);
        if (accessory) {
            this.log.debug('Reusing cached heater accessory.');
        }
        else {
            const name = this.config.name ?? 'MagIQTouch Heater';
            accessory = new this.api.platformAccessory(name, uuid);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            this.log.info(`Registered heater accessory: ${name}`);
        }
        // Construction wires the HeaterCooler service onto the accessory and
        // subscribes it to live status updates.
        new MagIQTouchHeaterAccessory(this, accessory, client);
        // Remove any stale cached accessories that no longer match.
        const stale = this.cachedAccessories.filter((a) => a.UUID !== uuid);
        if (stale.length) {
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
        }
    }
    startPolling() {
        this.pollTimer = setInterval(() => {
            this.client?.refreshStatus().catch((err) => this.log.debug(`poll failed: ${err.message}`));
        }, this.pollIntervalMs);
    }
    shutdown() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        void this.client?.stop();
    }
}
//# sourceMappingURL=platform.js.map