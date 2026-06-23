import { AuthenticationDetails, CognitoRefreshToken, CognitoUser, CognitoUserPool, } from 'amazon-cognito-identity-js';
/** Sniffed from the Seeley iOS app / the ha_magiqtouch integration. */
export const AWS_REGION = 'ap-southeast-2';
export const AWS_USER_POOL_ID = 'ap-southeast-2_uw5VVNlib';
export const AWS_CLIENT_ID = 'afh7fftbb0fg2rnagdbgd9b7b';
/** Raised when the email/password is rejected by Cognito. */
export class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthError';
    }
}
const AUTH_FAILURE_CODES = ['NotAuthorizedException', 'UserNotFoundException'];
/**
 * Wraps AWS Cognito SRP authentication for the MagIQTouch user pool.
 *
 * `getIdToken()` always returns a valid (un-expired) IdToken, transparently
 * refreshing via the refresh token when close to expiry, and falling back to a
 * full password login if the refresh token is no longer accepted.
 */
export class CognitoAuth {
    email;
    password;
    log;
    pool;
    user;
    session;
    /** Refresh once we are within this window of IdToken expiry. */
    static REFRESH_SKEW_SECONDS = 5 * 60;
    constructor(email, password, log) {
        this.email = email;
        this.password = password;
        this.log = log;
        this.pool = new CognitoUserPool({
            UserPoolId: AWS_USER_POOL_ID,
            ClientId: AWS_CLIENT_ID,
        });
    }
    /** Perform a fresh SRP login with the configured credentials. */
    async login() {
        this.user = new CognitoUser({ Username: this.email, Pool: this.pool });
        const details = new AuthenticationDetails({
            Username: this.email,
            Password: this.password,
        });
        this.session = await new Promise((resolve, reject) => {
            this.user.authenticateUser(details, {
                onSuccess: (session) => resolve(session),
                onFailure: (err) => {
                    if (err?.code && AUTH_FAILURE_CODES.includes(err.code)) {
                        reject(new AuthError(err.message ?? 'Invalid email or password'));
                    }
                    else {
                        reject(err instanceof Error ? err : new Error(String(err?.message ?? err)));
                    }
                },
            });
        });
        this.log.debug('Cognito login succeeded');
    }
    /** Returns a valid IdToken JWT, logging in or refreshing as needed. */
    async getIdToken() {
        if (!this.session) {
            await this.login();
        }
        else if (this.expiresWithinSkew()) {
            await this.refresh();
        }
        return this.session.getIdToken().getJwtToken();
    }
    expiresWithinSkew() {
        if (!this.session) {
            return true;
        }
        // getExpiration() is unix seconds.
        const expiry = this.session.getIdToken().getExpiration();
        const now = Math.floor(Date.now() / 1000);
        return expiry - now <= CognitoAuth.REFRESH_SKEW_SECONDS;
    }
    /** Renew the session using the refresh token; fall back to full login. */
    async refresh() {
        if (!this.user || !this.session) {
            return this.login();
        }
        const refreshToken = new CognitoRefreshToken({
            RefreshToken: this.session.getRefreshToken().getToken(),
        });
        try {
            this.session = await new Promise((resolve, reject) => {
                this.user.refreshSession(refreshToken, (err, session) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(session);
                    }
                });
            });
            this.log.debug('Cognito token refreshed');
        }
        catch (err) {
            this.log.warn('Token refresh failed, re-authenticating:', err?.message ?? err);
            await this.login();
        }
    }
}
//# sourceMappingURL=cognito.js.map