import type { Logger } from './logger.js';
/** Sniffed from the Seeley iOS app / the ha_magiqtouch integration. */
export declare const AWS_REGION = "ap-southeast-2";
export declare const AWS_USER_POOL_ID = "ap-southeast-2_uw5VVNlib";
export declare const AWS_CLIENT_ID = "afh7fftbb0fg2rnagdbgd9b7b";
/** Raised when the email/password is rejected by Cognito. */
export declare class AuthError extends Error {
    constructor(message: string);
}
/**
 * Wraps AWS Cognito SRP authentication for the MagIQTouch user pool.
 *
 * `getIdToken()` always returns a valid (un-expired) IdToken, transparently
 * refreshing via the refresh token when close to expiry, and falling back to a
 * full password login if the refresh token is no longer accepted.
 */
export declare class CognitoAuth {
    private readonly email;
    private readonly password;
    private readonly log;
    private readonly pool;
    private user?;
    private session?;
    /** Refresh once we are within this window of IdToken expiry. */
    private static readonly REFRESH_SKEW_SECONDS;
    constructor(email: string, password: string, log: Logger);
    /** Perform a fresh SRP login with the configured credentials. */
    login(): Promise<void>;
    /** Returns a valid IdToken JWT, logging in or refreshing as needed. */
    getIdToken(): Promise<string>;
    private expiresWithinSkew;
    /** Renew the session using the refresh token; fall back to full login. */
    private refresh;
}
