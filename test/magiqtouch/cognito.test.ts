import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  authImpl: vi.fn(),
  refreshImpl: vi.fn(),
}));

vi.mock('amazon-cognito-identity-js', () => {
  class CognitoUserPool {
    constructor(public opts: unknown) {}
  }
  class AuthenticationDetails {
    constructor(public opts: unknown) {}
  }
  class CognitoRefreshToken {
    constructor(public opts: unknown) {}
  }
  class CognitoUser {
    constructor(public opts: unknown) {}
    authenticateUser(details: unknown, cb: unknown) {
      h.authImpl(details, cb);
    }
    refreshSession(token: unknown, cb: unknown) {
      h.refreshImpl(token, cb);
    }
  }
  return { CognitoUserPool, AuthenticationDetails, CognitoRefreshToken, CognitoUser };
});

import { AuthError, CognitoAuth } from '../../src/magiqtouch/cognito.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function session(jwt: string, expiresInSec: number) {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  return {
    getIdToken: () => ({ getJwtToken: () => jwt, getExpiration: () => exp }),
    getRefreshToken: () => ({ getToken: () => 'refresh-token' }),
  };
}

beforeEach(() => {
  h.authImpl.mockReset();
  h.refreshImpl.mockReset();
  Object.values(log).forEach((f) => f.mockReset());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CognitoAuth', () => {
  it('logs in and returns the id token', async () => {
    h.authImpl.mockImplementation((_d, cb) => cb.onSuccess(session('jwt-1', 3600)));
    const auth = new CognitoAuth('a@b.com', 'pw', log);
    expect(await auth.getIdToken()).toBe('jwt-1');
    expect(h.authImpl).toHaveBeenCalledTimes(1);
  });

  it('maps NotAuthorizedException to AuthError', async () => {
    h.authImpl.mockImplementation((_d, cb) =>
      cb.onFailure({ code: 'NotAuthorizedException', message: 'bad creds' }),
    );
    const auth = new CognitoAuth('a@b.com', 'pw', log);
    await expect(auth.getIdToken()).rejects.toBeInstanceOf(AuthError);
  });

  it('maps UserNotFoundException to AuthError', async () => {
    h.authImpl.mockImplementation((_d, cb) =>
      cb.onFailure({ code: 'UserNotFoundException', message: 'nope' }),
    );
    const auth = new CognitoAuth('a@b.com', 'pw', log);
    await expect(auth.getIdToken()).rejects.toBeInstanceOf(AuthError);
  });

  it('passes other failures through as generic errors', async () => {
    h.authImpl.mockImplementation((_d, cb) =>
      cb.onFailure({ code: 'NetworkError', message: 'offline' }),
    );
    const auth = new CognitoAuth('a@b.com', 'pw', log);
    const err = await auth.getIdToken().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AuthError);
  });

  it('reuses a cached token when far from expiry', async () => {
    h.authImpl.mockImplementation((_d, cb) => cb.onSuccess(session('jwt-1', 3600)));
    const auth = new CognitoAuth('a@b.com', 'pw', log);
    await auth.getIdToken();
    await auth.getIdToken();
    expect(h.authImpl).toHaveBeenCalledTimes(1);
    expect(h.refreshImpl).not.toHaveBeenCalled();
  });

  it('refreshes when near expiry', async () => {
    h.authImpl.mockImplementation((_d, cb) => cb.onSuccess(session('jwt-old', 60)));
    h.refreshImpl.mockImplementation((_t, cb) => cb(null, session('jwt-new', 3600)));
    const auth = new CognitoAuth('a@b.com', 'pw', log);
    await auth.getIdToken();
    expect(await auth.getIdToken()).toBe('jwt-new');
    expect(h.refreshImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to a full login when refresh fails', async () => {
    h.authImpl
      .mockImplementationOnce((_d, cb) => cb.onSuccess(session('jwt-old', 60)))
      .mockImplementationOnce((_d, cb) => cb.onSuccess(session('jwt-relogin', 3600)));
    h.refreshImpl.mockImplementation((_t, cb) => cb(new Error('refresh rejected')));
    const auth = new CognitoAuth('a@b.com', 'pw', log);
    await auth.getIdToken();
    expect(await auth.getIdToken()).toBe('jwt-relogin');
    expect(h.authImpl).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalled();
  });
});
