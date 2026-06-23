import type { CognitoAuth } from './cognito.js';
import type { Logger } from './logger.js';
import type { SystemDetails } from './models.js';
/** Sniffed from the Seeley iOS app (replaces the older MQTT interface). */
export declare const API_URL = "https://tgjgb3bcf3.execute-api.ap-southeast-2.amazonaws.com/prod/v1/";
/**
 * Fetches the static system configuration from the cloud REST API.
 * Returns the first (only) system and validates that it carries a MAC address,
 * which is the device id used for all websocket calls.
 */
export declare function fetchSystemDetails(auth: CognitoAuth, log: Logger): Promise<{
    system: SystemDetails;
    macAddress: string;
}>;
