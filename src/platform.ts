import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  Service,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME, type MagIQTouchConfig } from './settings.js';
import { MagIQTouchClient } from './magiqtouch/client.js';
import { AuthError } from './magiqtouch/cognito.js';
import { MagIQTouchHeaterAccessory } from './platformAccessory.js';

/** Backoff before retrying after an auth failure — avoid Cognito lockout. */
const AUTH_RETRY_MS = 15 * 60 * 1000;
const START_RETRY_MS = 60 * 1000;

export class MagIQTouchPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  /** Accessories restored from Homebridge's cache on launch. */
  public readonly cachedAccessories: PlatformAccessory[] = [];

  public readonly client?: MagIQTouchClient;
  private pollTimer?: NodeJS.Timeout;
  private readonly pollIntervalMs: number;

  constructor(
    public readonly log: Logging,
    public readonly config: MagIQTouchConfig,
    public readonly api: API,
  ) {
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
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`Restoring cached accessory: ${accessory.displayName}`);
    this.cachedAccessories.push(accessory);
  }

  private async startClient(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await this.client.start();
      this.setupHeaterAccessory();
      this.startPolling();
      this.log.info('MagIQTouch connected.');

      this.client.on('connectionError', (err: Error) =>
        this.log.debug(`connection issue (will recover): ${err.message}`),
      );
    } catch (err) {
      if (err instanceof AuthError) {
        this.log.error(
          `MagIQTouch login failed — check email/password. Retrying in 15 min. (${err.message})`,
        );
        setTimeout(() => void this.startClient(), AUTH_RETRY_MS);
      } else {
        this.log.warn(`MagIQTouch start failed, retrying in 60s: ${(err as Error).message}`);
        setTimeout(() => void this.startClient(), START_RETRY_MS);
      }
    }
  }

  private setupHeaterAccessory(): void {
    const client = this.client!;
    const sys = client.system!;
    const mac = sys.Wifi_Module?.MacAddressId ?? 'unknown';
    const uuid = this.api.hap.uuid.generate(`magiqtouch-${mac}`);

    let accessory = this.cachedAccessories.find((a) => a.UUID === uuid);
    if (accessory) {
      this.log.debug('Reusing cached heater accessory.');
    } else {
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

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.client?.refreshStatus().catch((err) =>
        this.log.debug(`poll failed: ${(err as Error).message}`),
      );
    }, this.pollIntervalMs);
  }

  private shutdown(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    void this.client?.stop();
  }
}
