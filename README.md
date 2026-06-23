# homebridge-magiqtouch-heater

[![CI](https://github.com/wr-rusty/homebridge-magiqtouch-heater/actions/workflows/ci.yml/badge.svg)](https://github.com/wr-rusty/homebridge-magiqtouch-heater/actions/workflows/ci.yml)

A [Homebridge](https://homebridge.io) plugin that exposes a **Seeley MagIQTouch**–controlled
ducted gas heater (Braemar / Coolair and similar) to Apple HomeKit.

It talks to the same Seeley cloud the official MagIQtouch mobile app uses (AWS Cognito + an
API-Gateway WebSocket), so it works from anywhere — no local network access to the wall
controller is required.

> **Scope:** this plugin targets a **gas-heater-only, single-zone** system. It exposes one HomeKit
> *Heater Cooler* accessory limited to heating: **on/off**, **current temperature**, and **target
> temperature**, with **optional** fan-speed and fan-only controls. Cooling, evaporative/add-on
> coolers, and multiple zones are not yet supported (PRs/testers with that hardware welcome).

## Requirements

- Homebridge v1.8+ or v2, Node 20 / 22 / 24.
- A Seeley MagIQtouch account (the email + password you use in the MagIQtouch app).

## Installation

This plugin is published on GitHub (not yet on npm). Install it directly from the repo:

```sh
sudo npm install -g github:wr-rusty/homebridge-magiqtouch-heater
```

Then restart Homebridge. It will appear as **MagIQTouch Heater** in the Homebridge UI.

## Configuration

Add a platform block to your `config.json`, or use the settings form in the Homebridge UI:

```json
{
  "platforms": [
    {
      "platform": "MagIQTouch",
      "name": "MagIQTouch",
      "email": "you@example.com",
      "password": "your-seeley-password",
      "pollInterval": 60,
      "exposeFan": false,
      "exposeFanOnlyMode": false,
      "debug": false
    }
  ]
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `email` / `password` | — | Your Seeley MagIQtouch account credentials (**required**). |
| `pollInterval` | `60` | Safety-net status refresh interval, in seconds. Live updates also arrive over the websocket. |
| `exposeFan` | `false` | Show the heater fan speed as a slider (RotationSpeed) on the heater tile. |
| `exposeFanOnlyMode` | `false` | Add a separate Fan accessory for running the heater fan without heat. |
| `debug` | `false` | Verbose protocol logging. |

> ⚠️ Credentials are stored in plain text in Homebridge's `config.json`, like every cloud
> Homebridge plugin. Protect that file accordingly.

### Recommended: run as a child bridge

Running this plugin in its own process isolates its long-lived websocket from the main bridge.
Enable **Child Bridge** for the plugin in the Homebridge UI, or add a `_bridge` block to the
platform entry:

```json
{
  "platform": "MagIQTouch",
  "name": "MagIQTouch",
  "email": "you@example.com",
  "password": "your-seeley-password",
  "_bridge": { "username": "0E:AA:BB:CC:DD:EE", "port": 8581 }
}
```

You then pair the child bridge separately in the Home app using the QR code Homebridge prints.

## HomeKit behaviour

The heater appears as a *Heater Cooler* tile:

- **On/Off** turns the system on (heating) or off.
- **Mode** is fixed to *Heat* (no cooling or auto).
- **Current temperature** reflects the heater's measured temperature.
- **Target temperature** sets the heating setpoint, clamped to the heater's supported range.
- A fault reported by the heater surfaces as a HomeKit fault; if the unit goes offline the tile
  shows *No Response*.
- With `exposeFan`, a fan-speed slider appears on the tile. With `exposeFanOnlyMode`, a separate
  Fan accessory runs the fan without calling for heat.

## Testing the connection without Homebridge

A standalone harness validates the whole protocol against the live cloud using your credentials
(which never leave your machine):

```sh
npm run build
MQT_EMAIL=you@example.com MQT_PASSWORD=secret node dist/cli/harness.js
```

It prints your system details and a live status snapshot. Guarded actions:

```sh
node dist/cli/harness.js --on            # heating on
node dist/cli/harness.js --off           # off
node dist/cli/harness.js --temp 23       # set target temperature
node dist/cli/harness.js --fan 5         # set fan speed
node dist/cli/harness.js --fan-only      # heater fan-only mode
```

## How it works

The protocol was reverse-engineered from the Home Assistant integration
[`andrewleech/ha_magiqtouch`](https://github.com/andrewleech/ha_magiqtouch):

1. **Auth** — AWS Cognito SRP login (`ap-southeast-2`) → IdToken (auto-refreshed).
2. **Config** — `GET …/devices/system` for the device MAC and heater temperature range.
3. **State + control** — a `wss://…` API-Gateway WebSocket: `{"action":"status",…}` to read,
   `{"action":"command",…}` to set, with each command confirmed against the echoed state.

Two things this plugin gets right that tripped up earlier clients:

- **Millisecond timestamps.** Commands must carry a `Date.now()` (ms) timestamp; a seconds value is
  rejected by the device as stale, which silently breaks control.
- **Connection liveness.** The long-lived control websocket can go silently half-open; the plugin
  pings, watches for traffic, and recycles + retries so commands keep working.

## Relationship to `homebridge-magiqtouch`

The older `homebridge-magiqtouch` package is unmaintained and uses the legacy polling API. This
plugin is an independent rewrite using the current websocket protocol, with the fixes above.

## Development

```sh
npm install
npm run build      # compile TypeScript -> dist/
npm test           # vitest unit + integration tests
npm run test:cov   # with coverage
npm run lint
npm run watch      # rebuild + run Homebridge in debug/insecure mode
```

## Disclaimer

This is an unofficial, independent project and is not affiliated with or endorsed by Seeley
International. Use at your own risk.

## License

MIT
