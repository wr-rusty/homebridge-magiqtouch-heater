import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ authImpl: vi.fn() }));

vi.mock('amazon-cognito-identity-js', () => {
  class CognitoUserPool {
    constructor(public o: unknown) {}
  }
  class AuthenticationDetails {
    constructor(public o: unknown) {}
  }
  class CognitoRefreshToken {
    constructor(public o: unknown) {}
  }
  class CognitoUser {
    constructor(public o: unknown) {}
    authenticateUser(d: unknown, cb: unknown) {
      h.authImpl(d, cb);
    }
    refreshSession() {}
  }
  return { CognitoUserPool, AuthenticationDetails, CognitoRefreshToken, CognitoUser };
});

import { MagIQTouchClient } from '../../src/magiqtouch/client.js';
import { AuthError } from '../../src/magiqtouch/cognito.js';
import { FakeWsServer } from '../helpers/fakeWsServer.js';
import { makeStatus, makeSystemDetails } from '../helpers/fixtures.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function authSucceeds() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  h.authImpl.mockImplementation((_d, cb) =>
    cb.onSuccess({
      getIdToken: () => ({ getJwtToken: () => 'jwt', getExpiration: () => exp }),
      getRefreshToken: () => ({ getToken: () => 'r' }),
    }),
  );
}

function stubSystemFetch(initial = makeStatus({ systemOn: true })) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [makeSystemDetails()] })),
  );
  return initial;
}

let server: FakeWsServer;
let client: MagIQTouchClient;

async function startClient(mode: Parameters<FakeWsServer['setMode']>[0] = 'confirm', timeoutMs = 200) {
  authSucceeds();
  const initial = stubSystemFetch();
  server = new FakeWsServer(mode, initial);
  await server.ready();
  client = new MagIQTouchClient('a@b.com', 'pw', log, { url: server.url }, timeoutMs);
  await client.start();
}

beforeEach(() => {
  Object.values(log).forEach((f) => f.mockReset());
  h.authImpl.mockReset();
});

afterEach(async () => {
  await client?.stop();
  await server?.close();
  vi.unstubAllGlobals();
});

describe('MagIQTouchClient', () => {
  it('starts: logs in, loads system, primes status', async () => {
    await startClient();
    expect(client.system?.System?.Name).toBe('My Home');
    expect(client.status?.systemOn).toBe(true);
  });

  it('propagates an AuthError from login', async () => {
    h.authImpl.mockImplementation((_d, cb) =>
      cb.onFailure({ code: 'NotAuthorizedException', message: 'bad' }),
    );
    stubSystemFetch();
    server = new FakeWsServer('confirm');
    await server.ready();
    client = new MagIQTouchClient('a@b.com', 'pw', log, { url: server.url }, 200);
    await expect(client.start()).rejects.toBeInstanceOf(AuthError);
  });

  it('REGRESSION: command timestamp is in milliseconds (not seconds)', async () => {
    await startClient();
    await client.setHeating();
    const sent = server.commands.at(-1)!;
    expect(sent.timestamp).toBeGreaterThan(1e12);
    expect(Math.abs(sent.timestamp - Date.now())).toBeLessThan(5000);
  });

  it('setHeating sends systemOn + HEAT + required-running heater', async () => {
    await startClient();
    await client.setHeating();
    const sent = server.commands.at(-1)!;
    expect(sent.systemOn).toBe(true);
    expect(sent.runningMode).toBe('HEAT');
    expect(sent.heater[0].runningState).toBe('REQUIRED_RUNNING');
  });

  it('setSystemOn(false) only turns the system off', async () => {
    await startClient();
    await client.setSystemOn(false);
    const sent = server.commands.at(-1)!;
    expect(sent.systemOn).toBe(false);
    // It must not force HEAT/required-running like setHeating does.
    expect(sent.heater[0].runningState).toBe('NOT_REQUIRED');
  });

  it('setTargetTemperature rounds and uses TEMP control mode', async () => {
    await startClient();
    await client.setTargetTemperature(22.6);
    const sent = server.commands.at(-1)!;
    expect(sent.heater[0].set_temp).toBe(23);
    expect(sent.heater[0].control_mode).toBe('TEMP');
  });

  it('setFanSpeed clamps and uses FAN control mode', async () => {
    await startClient();
    await client.setFanSpeed(99);
    let sent = server.commands.at(-1)!;
    expect(sent.heater[0].fan_speed).toBe(10); // clamped to max_fan_speed
    expect(sent.heater[0].control_mode).toBe('FAN');

    await client.setFanSpeed(0);
    sent = server.commands.at(-1)!;
    expect(sent.heater[0].fan_speed).toBe(1); // clamped to min 1
  });

  it('setFanOnly enters HEATER_FAN without requesting heat', async () => {
    await startClient();
    await client.setFanOnly();
    const sent = server.commands.at(-1)!;
    expect(sent.systemOn).toBe(true);
    expect(sent.runningMode).toBe('HEATER_FAN');
    expect(sent.heater[0].runningState).toBe('NOT_REQUIRED');
  });

  it('on an unconfirmed command, resyncs and rethrows', async () => {
    await startClient('status-only', 80);
    const refreshSpy = vi.spyOn(client, 'refreshStatus');
    await expect(client.setHeating()).rejects.toThrow(/timed out/);
    expect(refreshSpy).toHaveBeenCalled();
  });
});
