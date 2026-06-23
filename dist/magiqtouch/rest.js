/** Sniffed from the Seeley iOS app (replaces the older MQTT interface). */
export const API_URL = 'https://tgjgb3bcf3.execute-api.ap-southeast-2.amazonaws.com/prod/v1/';
/**
 * Fetches the static system configuration from the cloud REST API.
 * Returns the first (only) system and validates that it carries a MAC address,
 * which is the device id used for all websocket calls.
 */
export async function fetchSystemDetails(auth, log) {
    const token = await auth.getIdToken();
    const res = await fetch(`${API_URL}devices/system`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        throw new Error(`devices/system returned HTTP ${res.status}: ${await res.text()}`);
    }
    let body;
    try {
        body = await res.json();
    }
    catch (err) {
        throw new Error(`devices/system returned an unparseable body: ${err.message}`);
    }
    if (!Array.isArray(body) || body.length === 0) {
        throw new Error(`devices/system returned no systems: ${JSON.stringify(body)}`);
    }
    const system = body[0];
    const macAddress = system.Wifi_Module?.MacAddressId;
    if (!macAddress) {
        throw new Error('devices/system response is missing Wifi_Module.MacAddressId');
    }
    log.debug(`System "${system.System?.Name ?? 'unknown'}" found (device ${macAddress})`);
    return { system, macAddress };
}
//# sourceMappingURL=rest.js.map