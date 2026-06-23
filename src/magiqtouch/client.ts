import { EventEmitter } from 'node:events';

import { AuthError, CognitoAuth } from './cognito.js';
import {
  all,
  expectHeaterFanSpeed,
  expectHeaterSetTemp,
  expectMode,
  expectSystemOn,
  type Checker,
} from './checker.js';
import { fetchSystemDetails } from './rest.js';
import { MagIQTouchWebSocket, type WebSocketOptions } from './websocket.js';
import {
  RUNNING_STATE_IDLE,
  RUNNING_STATE_REQUIRED,
  getHeater,
  type RemoteStatus,
  type SystemDetails,
} from './models.js';
import type { Logger } from './logger.js';

const COMMAND_TIMEOUT_MS = 8000;

/**
 * High-level MagIQTouch client. Authenticates, fetches static config, holds a
 * live status websocket, and exposes heater control methods.
 *
 * Events:
 *   'status'          (status: RemoteStatus) — latest live state.
 *   'authError'       (err: AuthError)       — bad credentials; caller should stop.
 *   'connectionError' (err: Error)           — transient connection failure.
 */
export class MagIQTouchClient extends EventEmitter {
  private readonly auth: CognitoAuth;
  private ws?: MagIQTouchWebSocket;
  private systemDetails?: SystemDetails;
  private lastStatus?: RemoteStatus;

  constructor(
    email: string,
    password: string,
    private readonly log: Logger,
    /** Optional websocket overrides (base URL / factory) — used by tests. */
    private readonly wsOptions: WebSocketOptions = {},
    /** Per-command confirmation timeout (ms). */
    private readonly commandTimeoutMs = COMMAND_TIMEOUT_MS,
  ) {
    super();
    this.auth = new CognitoAuth(email, password, log);
  }

  get system(): SystemDetails | undefined {
    return this.systemDetails;
  }

  get status(): RemoteStatus | undefined {
    return this.lastStatus;
  }

  /** Authenticate, load static config, open the live status websocket. */
  async start(): Promise<void> {
    // login() throws AuthError on bad creds — let the platform handle it.
    await this.auth.login();
    const { system, macAddress } = await fetchSystemDetails(this.auth, this.log);
    this.systemDetails = system;

    this.ws = new MagIQTouchWebSocket(
      () => this.auth.getIdToken(),
      macAddress,
      this.log,
      this.wsOptions,
    );
    this.ws.on('status', (status: RemoteStatus) => {
      this.lastStatus = status;
      try {
        this.emit('status', status);
      } catch (err) {
        this.log.debug(`status listener error: ${(err as Error).message}`);
      }
    });

    // Prime the cache with an initial status read.
    await this.refreshStatus();
  }

  /** Request a fresh status now (also used as a safety-net poll). */
  async refreshStatus(): Promise<RemoteStatus | undefined> {
    if (!this.ws) {
      return undefined;
    }
    try {
      const status = await this.ws.requestStatus();
      this.lastStatus = status;
      return status;
    } catch (err) {
      this.emit('connectionError', err as Error);
      this.log.debug(`status refresh failed: ${(err as Error).message}`);
      return undefined;
    }
  }

  async stop(): Promise<void> {
    this.ws?.close();
    this.ws = undefined;
  }

  /** Turn the whole system on (into heating) or off. */
  async setSystemOn(on: boolean): Promise<void> {
    if (on) {
      await this.setHeating();
    } else {
      await this.command((s) => {
        s.systemOn = false;
      }, expectSystemOn(false));
    }
  }

  /** Switch the system on in heating mode. */
  async setHeating(): Promise<void> {
    await this.command((s) => {
      s.systemOn = true;
      s.runningMode = 'HEAT';
      for (const unit of s.heater) {
        unit.runningState = RUNNING_STATE_REQUIRED;
        unit.zoneRunningState = RUNNING_STATE_REQUIRED;
      }
    }, all(expectSystemOn(true), expectMode('HEAT')));
  }

  /** Set the heater target temperature (temperature-controlled mode). */
  async setTargetTemperature(temp: number): Promise<void> {
    const target = Math.round(temp);
    await this.command((s) => {
      const heater = getHeater(s);
      if (heater) {
        heater.set_temp = target;
        heater.control_mode = 'TEMP';
      }
    }, expectHeaterSetTemp(target));
  }

  /** Set the heater fan speed (fan-controlled mode), clamped to the unit range. */
  async setFanSpeed(speed: number): Promise<void> {
    const heater = getHeater(this.lastStatus);
    const max = heater?.max_fan_speed && heater.max_fan_speed > 0 ? heater.max_fan_speed : 10;
    const clamped = Math.max(1, Math.min(max, Math.round(speed)));
    await this.command((s) => {
      const unit = getHeater(s);
      if (unit) {
        unit.fan_speed = clamped;
        unit.control_mode = 'FAN';
      }
    }, expectHeaterFanSpeed(clamped));
  }

  /** Switch the system into heater fan-only mode (fan runs, no heat called). */
  async setFanOnly(): Promise<void> {
    await this.command((s) => {
      s.systemOn = true;
      s.runningMode = 'HEATER_FAN';
      // Fan-only must not request the burner to fire.
      for (const unit of s.heater) {
        unit.runningState = RUNNING_STATE_IDLE;
        unit.zoneRunningState = RUNNING_STATE_IDLE;
      }
    }, all(expectSystemOn(true), expectMode('HEATER_FAN')));
  }

  /**
   * Clone the last known status, apply `mutate`, stamp a fresh timestamp, and
   * send it as a command — resolving once `checker` confirms the echo.
   */
  private async command(mutate: (s: RemoteStatus) => void, checker: Checker): Promise<void> {
    if (!this.ws) {
      throw new Error('client not started');
    }
    if (!this.lastStatus) {
      // Need a baseline to mutate; fetch one first.
      await this.refreshStatus();
    }
    if (!this.lastStatus) {
      throw new Error('no status available to build command from');
    }

    const params: RemoteStatus = structuredClone(this.lastStatus);
    mutate(params);
    // The device reports timestamps in milliseconds; a command must be at least
    // as fresh as the device's current timestamp or it is rejected as stale.
    params.timestamp = Date.now();

    try {
      const confirmed = await this.ws.sendCommand(params, checker, this.commandTimeoutMs);
      this.lastStatus = confirmed;
    } catch (err) {
      this.log.warn(`command not confirmed: ${(err as Error).message}; resyncing`);
      await this.refreshStatus();
      throw err;
    }
  }

  /** Re-export for callers that need to distinguish auth failures. */
  static isAuthError(err: unknown): err is AuthError {
    return err instanceof AuthError;
  }
}
