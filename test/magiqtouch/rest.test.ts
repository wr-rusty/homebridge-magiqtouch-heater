import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchSystemDetails, API_URL } from '../../src/magiqtouch/rest.js';
import type { CognitoAuth } from '../../src/magiqtouch/cognito.js';
import { makeSystemDetails } from '../helpers/fixtures.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const auth = { getIdToken: vi.fn(async () => 'jwt') } as unknown as CognitoAuth;

function mockFetch(impl: () => unknown) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  Object.values(log).forEach((f) => f.mockReset());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchSystemDetails', () => {
  it('returns the system and mac, with a Bearer token and the right URL', async () => {
    const sys = makeSystemDetails();
    const fetchFn = mockFetch(() => ({ ok: true, status: 200, json: async () => [sys] }));

    const result = await fetchSystemDetails(auth, log);

    expect(result.macAddress).toBe('D43639AD76F8');
    expect(result.system.System?.Name).toBe('My Home');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${API_URL}devices/system`);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt' });
  });

  it('throws on an HTTP error', async () => {
    mockFetch(() => ({ ok: false, status: 502, text: async () => 'bad gateway' }));
    await expect(fetchSystemDetails(auth, log)).rejects.toThrow(/HTTP 502/);
  });

  it('throws when the body is an empty array', async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => [] }));
    await expect(fetchSystemDetails(auth, log)).rejects.toThrow(/no systems/);
  });

  it('throws when the body is not an array', async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({}) }));
    await expect(fetchSystemDetails(auth, log)).rejects.toThrow(/no systems/);
  });

  it('throws when MacAddressId is missing', async () => {
    const sys = makeSystemDetails({ Wifi_Module: {} });
    mockFetch(() => ({ ok: true, status: 200, json: async () => [sys] }));
    await expect(fetchSystemDetails(auth, log)).rejects.toThrow(/MacAddressId/);
  });

  it('throws a descriptive error on an unparseable body', async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));
    await expect(fetchSystemDetails(auth, log)).rejects.toThrow(/unparseable body/);
  });

  it('propagates a network error', async () => {
    mockFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    await expect(fetchSystemDetails(auth, log)).rejects.toThrow(/ECONNREFUSED/);
  });
});
