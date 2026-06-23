import { EventEmitter } from 'node:events';
import { AuthError } from './cognito.js';
import { type WebSocketOptions } from './websocket.js';
import { type RemoteStatus, type SystemDetails } from './models.js';
import type { Logger } from './logger.js';
/**
 * High-level MagIQTouch client. Authenticates, fetches static config, holds a
 * live status websocket, and exposes heater control methods.
 *
 * Events:
 *   'status'          (status: RemoteStatus) — latest live state.
 *   'authError'       (err: AuthError)       — bad credentials; caller should stop.
 *   'connectionError' (err: Error)           — transient connection failure.
 */
export declare class MagIQTouchClient extends EventEmitter {
    private readonly log;
    /** Optional websocket overrides (base URL / factory) — used by tests. */
    private readonly wsOptions;
    /** Per-command confirmation timeout (ms). */
    private readonly commandTimeoutMs;
    private readonly auth;
    private ws?;
    private systemDetails?;
    private lastStatus?;
    constructor(email: string, password: string, log: Logger, 
    /** Optional websocket overrides (base URL / factory) — used by tests. */
    wsOptions?: WebSocketOptions, 
    /** Per-command confirmation timeout (ms). */
    commandTimeoutMs?: number);
    get system(): SystemDetails | undefined;
    get status(): RemoteStatus | undefined;
    /** Authenticate, load static config, open the live status websocket. */
    start(): Promise<void>;
    /** Request a fresh status now (also used as a safety-net poll). */
    refreshStatus(): Promise<RemoteStatus | undefined>;
    stop(): Promise<void>;
    /** Turn the whole system on (into heating) or off. */
    setSystemOn(on: boolean): Promise<void>;
    /** Switch the system on in heating mode. */
    setHeating(): Promise<void>;
    /** Set the heater target temperature (temperature-controlled mode). */
    setTargetTemperature(temp: number): Promise<void>;
    /** Set the heater fan speed (fan-controlled mode), clamped to the unit range. */
    setFanSpeed(speed: number): Promise<void>;
    /** Switch the system into heater fan-only mode (fan runs, no heat called). */
    setFanOnly(): Promise<void>;
    /**
     * Clone the last known status, apply `mutate`, stamp a fresh timestamp, and
     * send it as a command — resolving once `checker` confirms the echo.
     */
    private command;
    /** Re-export for callers that need to distinguish auth failures. */
    static isAuthError(err: unknown): err is AuthError;
}
