import { getHeater, isHeaterRunning, unitTempToCelsius, } from './magiqtouch/models.js';
/** Coalesce rapid HomeKit setter calls (e.g. a temperature slider drag). */
const SETTER_DEBOUNCE_MS = 400;
const DEFAULT_MIN_TEMP = 7;
const DEFAULT_MAX_TEMP = 35;
/** MagIQTouch heaters expose fan speeds 1..10. */
const FAN_MAX = 10;
function speedToPercent(speed, max = FAN_MAX) {
    if (max <= 0) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round((speed / max) * 100)));
}
function percentToSpeed(percent, max = FAN_MAX) {
    return Math.max(1, Math.min(max, Math.round((percent / 100) * max)));
}
/**
 * A single HEAT-only HeaterCooler accessory representing the gas heater:
 * on/off + current/target temperature. Fan speed (RotationSpeed on the tile)
 * and a separate fan-only Fan tile are opt-in via config.
 */
export class MagIQTouchHeaterAccessory {
    platform;
    accessory;
    client;
    service;
    fanService;
    C;
    exposeFan;
    exposeFanOnlyMode;
    pendingActive;
    pendingTemp;
    pendingFanSpeed;
    pendingFanOnly;
    flushTimer;
    constructor(platform, accessory, client) {
        this.platform = platform;
        this.accessory = accessory;
        this.client = client;
        this.C = platform.Characteristic;
        this.exposeFan = !!platform.config.exposeFan;
        this.exposeFanOnlyMode = !!platform.config.exposeFanOnlyMode;
        const sys = client.system;
        this.accessory
            .getService(platform.Service.AccessoryInformation)
            .setCharacteristic(this.C.Manufacturer, 'Seeley')
            .setCharacteristic(this.C.Model, sys?.System?.Name ?? 'MagIQTouch Heater')
            .setCharacteristic(this.C.SerialNumber, sys?.Wifi_Module?.MacAddressId ?? 'unknown')
            .setCharacteristic(this.C.FirmwareRevision, sys?.WallController?.Firmware ?? '1.0.0');
        this.service =
            this.accessory.getService(platform.Service.HeaterCooler) ??
                this.accessory.addService(platform.Service.HeaterCooler);
        this.service.setCharacteristic(this.C.Name, this.accessory.displayName);
        // Active (on/off).
        this.service
            .getCharacteristic(this.C.Active)
            .onGet(() => this.guard(() => this.getActive()))
            .onSet((v) => this.setActive(v));
        // Current state (read-only).
        this.service.getCharacteristic(this.C.CurrentHeaterCoolerState).onGet(() => this.guard(() => this.getCurrentState()));
        // Target state — restricted to HEAT only.
        this.service
            .getCharacteristic(this.C.TargetHeaterCoolerState)
            .setProps({ validValues: [this.C.TargetHeaterCoolerState.HEAT] })
            .updateValue(this.C.TargetHeaterCoolerState.HEAT)
            .onGet(() => this.C.TargetHeaterCoolerState.HEAT)
            .onSet(() => {
            /* HEAT is the only value; nothing to do. */
        });
        this.service.getCharacteristic(this.C.CurrentTemperature).onGet(() => this.guard(() => this.getCurrentTemperature()));
        // Heating target temperature, bounded to the heater's supported range.
        const minTemp = sys?.Heater?.MinimumTemperature ?? DEFAULT_MIN_TEMP;
        const maxTemp = sys?.Heater?.MaximumTemperature ?? DEFAULT_MAX_TEMP;
        this.service
            .getCharacteristic(this.C.HeatingThresholdTemperature)
            .setProps({ minValue: minTemp, maxValue: maxTemp, minStep: 1 })
            .onGet(() => this.guard(() => this.getTargetTemperature()))
            .onSet((v) => this.setTargetTemperature(v));
        // Optional: fan speed as a RotationSpeed slider on the heater tile.
        if (this.exposeFan) {
            this.service
                .getCharacteristic(this.C.RotationSpeed)
                .setProps({ minValue: 0, maxValue: 100, minStep: 100 / this.maxFanSpeed() })
                .onGet(() => this.getFanSpeedPercent())
                .onSet((v) => this.setFanSpeedPercent(v));
        }
        else if (this.service.testCharacteristic(this.C.RotationSpeed)) {
            // Toggled off after previously being enabled — drop the stale characteristic.
            this.service.removeCharacteristic(this.service.getCharacteristic(this.C.RotationSpeed));
        }
        // Optional: a separate Fan tile for heater fan-only mode.
        if (this.exposeFanOnlyMode) {
            this.fanService =
                this.accessory.getServiceById(platform.Service.Fanv2, 'fan-only') ??
                    this.accessory.addService(platform.Service.Fanv2, 'Heater Fan', 'fan-only');
            this.fanService
                .getCharacteristic(this.C.Active)
                .onGet(() => this.getFanOnlyActive())
                .onSet((v) => this.setFanOnlyActive(v));
            this.fanService
                .getCharacteristic(this.C.RotationSpeed)
                .setProps({ minValue: 0, maxValue: 100, minStep: 100 / this.maxFanSpeed() })
                .onGet(() => this.getFanSpeedPercent())
                .onSet((v) => this.setFanSpeedPercent(v));
        }
        else {
            const existing = this.accessory.getServiceById(platform.Service.Fanv2, 'fan-only');
            if (existing) {
                this.accessory.removeService(existing);
            }
        }
        // Push live updates from the websocket into HomeKit.
        this.client.on('status', (status) => this.pushStatus(status));
        if (this.client.status) {
            this.pushStatus(this.client.status);
        }
    }
    maxFanSpeed() {
        const max = getHeater(this.client.status)?.max_fan_speed;
        return max && max > 0 ? max : FAN_MAX;
    }
    /**
     * Wrap an onGet computation so that, once the device has reported itself
     * offline, HomeKit shows "No Response" instead of a stale value.
     */
    guard(compute) {
        const status = this.client.status;
        if (status && status.online === false) {
            const { HapStatusError, HAPStatus } = this.platform.api.hap;
            throw new HapStatusError(-70402 /* HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
        return compute();
    }
    // --- getters (synchronous, from cached state) ---
    getActive() {
        return this.client.status?.systemOn
            ? this.C.Active.ACTIVE
            : this.C.Active.INACTIVE;
    }
    getCurrentState() {
        const status = this.client.status;
        if (!status?.systemOn) {
            return this.C.CurrentHeaterCoolerState.INACTIVE;
        }
        return isHeaterRunning(getHeater(status))
            ? this.C.CurrentHeaterCoolerState.HEATING
            : this.C.CurrentHeaterCoolerState.IDLE;
    }
    getCurrentTemperature() {
        const heater = getHeater(this.client.status);
        if (!heater) {
            return 0;
        }
        return unitTempToCelsius(heater.actual_temp, heater.temperature_units);
    }
    getTargetTemperature() {
        const heater = getHeater(this.client.status);
        if (!heater) {
            return DEFAULT_MIN_TEMP;
        }
        return unitTempToCelsius(heater.set_temp, heater.temperature_units);
    }
    getFanSpeedPercent() {
        const heater = getHeater(this.client.status);
        if (!heater) {
            return 0;
        }
        return speedToPercent(heater.fan_speed, this.maxFanSpeed());
    }
    getFanOnlyActive() {
        const status = this.client.status;
        return status?.systemOn && status.runningMode === 'HEATER_FAN'
            ? this.C.Active.ACTIVE
            : this.C.Active.INACTIVE;
    }
    // --- setters (optimistic + debounced) ---
    async setActive(value) {
        this.pendingActive = value === this.C.Active.ACTIVE;
        this.scheduleFlush();
    }
    async setTargetTemperature(value) {
        this.pendingTemp = value;
        this.scheduleFlush();
    }
    async setFanSpeedPercent(value) {
        this.pendingFanSpeed = percentToSpeed(value, this.maxFanSpeed());
        this.scheduleFlush();
    }
    async setFanOnlyActive(value) {
        this.pendingFanOnly = value === this.C.Active.ACTIVE;
        this.scheduleFlush();
    }
    scheduleFlush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }
        this.flushTimer = setTimeout(() => {
            this.flush().catch((err) => this.platform.log.debug(`flush error: ${err.message}`));
        }, SETTER_DEBOUNCE_MS);
    }
    async flush() {
        this.flushTimer = undefined;
        const active = this.pendingActive;
        const temp = this.pendingTemp;
        const fanSpeed = this.pendingFanSpeed;
        const fanOnly = this.pendingFanOnly;
        this.pendingActive = undefined;
        this.pendingTemp = undefined;
        this.pendingFanSpeed = undefined;
        this.pendingFanOnly = undefined;
        try {
            // Fan-only on/off takes precedence over the heat on/off for the mode.
            if (fanOnly !== undefined) {
                await (fanOnly ? this.client.setFanOnly() : this.client.setSystemOn(false));
            }
            else if (active !== undefined) {
                await this.client.setSystemOn(active);
            }
            if (temp !== undefined) {
                await this.client.setTargetTemperature(temp);
            }
            if (fanSpeed !== undefined) {
                await this.client.setFanSpeed(fanSpeed);
            }
        }
        catch (err) {
            this.platform.log.warn(`Command failed: ${err.message}`);
            // Revert HomeKit to the confirmed device state.
            if (this.client.status) {
                this.pushStatus(this.client.status);
            }
        }
    }
    // --- live updates into HomeKit ---
    pushStatus(status) {
        try {
            this.applyStatus(status);
        }
        catch (err) {
            this.platform.log.debug(`failed to apply status: ${err.message}`);
        }
    }
    applyStatus(status) {
        const heater = getHeater(status);
        this.service.updateCharacteristic(this.C.Active, this.getActive());
        this.service.updateCharacteristic(this.C.CurrentHeaterCoolerState, this.getCurrentState());
        if (heater) {
            this.service.updateCharacteristic(this.C.CurrentTemperature, unitTempToCelsius(heater.actual_temp, heater.temperature_units));
            this.service.updateCharacteristic(this.C.HeatingThresholdTemperature, unitTempToCelsius(heater.set_temp, heater.temperature_units));
            this.service.updateCharacteristic(this.C.TemperatureDisplayUnits, heater.temperature_units?.toLowerCase() === 'f'
                ? this.C.TemperatureDisplayUnits.FAHRENHEIT
                : this.C.TemperatureDisplayUnits.CELSIUS);
            if (this.exposeFan) {
                this.service.updateCharacteristic(this.C.RotationSpeed, speedToPercent(heater.fan_speed, this.maxFanSpeed()));
            }
        }
        this.service.updateCharacteristic(this.C.StatusFault, status.heaterFault
            ? this.C.StatusFault.GENERAL_FAULT
            : this.C.StatusFault.NO_FAULT);
        if (this.fanService) {
            this.fanService.updateCharacteristic(this.C.Active, this.getFanOnlyActive());
            if (heater) {
                this.fanService.updateCharacteristic(this.C.RotationSpeed, speedToPercent(heater.fan_speed, this.maxFanSpeed()));
            }
        }
    }
}
//# sourceMappingURL=platformAccessory.js.map