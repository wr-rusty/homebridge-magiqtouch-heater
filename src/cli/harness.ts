/**
 * Standalone protocol test harness — no Homebridge required.
 *
 * Validates the full cloud protocol against the live Seeley API before any
 * HomeKit wiring. Credentials come from the environment and never leave your
 * machine.
 *
 *   MQT_EMAIL=you@example.com MQT_PASSWORD=secret node dist/cli/harness.js
 *
 * Optional guarded actions (each waits for the device to confirm):
 *   --on              turn the heater on (heating mode)
 *   --off             turn the heater off
 *   --temp <celsius>  set the target temperature
 *
 * With no action it just prints system details and one live status snapshot.
 */
import { MagIQTouchClient } from '../magiqtouch/client.js';
import { getHeater } from '../magiqtouch/models.js';
import { consoleLogger } from '../magiqtouch/logger.js';

interface Args {
  on: boolean;
  off: boolean;
  fanOnly: boolean;
  temp?: number;
  fan?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { on: false, off: false, fanOnly: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--on':
        args.on = true;
        break;
      case '--off':
        args.off = true;
        break;
      case '--fan-only':
        args.fanOnly = true;
        break;
      case '--temp':
        args.temp = Number(argv[++i]);
        break;
      case '--fan':
        args.fan = Number(argv[++i]);
        break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const email = process.env.MQT_EMAIL;
  const password = process.env.MQT_PASSWORD;
  if (!email || !password) {
    console.error('Set MQT_EMAIL and MQT_PASSWORD environment variables.');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const client = new MagIQTouchClient(email, password, consoleLogger);

  try {
    console.log('Logging in and fetching system details...');
    await client.start();

    const sys = client.system!;
    console.log('\n=== System ===');
    console.log('Name:        ', sys.System?.Name);
    console.log('Device (MAC):', sys.Wifi_Module?.MacAddressId);
    console.log('Zones:       ', sys.NoOfZoneControls ?? 0);
    console.log(
      'Heater temp: ',
      `${sys.Heater?.MinimumTemperature ?? '?'}–${sys.Heater?.MaximumTemperature ?? '?'}`,
    );

    const status = client.status;
    console.log('\n=== Live status ===');
    console.log('systemOn:   ', status?.systemOn);
    console.log('online:     ', status?.online);
    console.log('runningMode:', status?.runningMode);
    const heater = getHeater(status!);
    if (heater) {
      console.log('set_temp:   ', heater.set_temp, heater.temperature_units);
      console.log('actual_temp:', heater.actual_temp);
      console.log('runningState:', heater.runningState);
    }
    console.log('\nfull payload:', JSON.stringify(status, null, 2));

    if (args.off) {
      console.log('\nTurning OFF...');
      await client.setSystemOn(false);
      console.log('Confirmed off.');
    } else if (args.on) {
      console.log('\nTurning ON (heating)...');
      await client.setHeating();
      console.log('Confirmed on.');
    }

    if (args.fanOnly) {
      console.log('\nSwitching to fan-only...');
      await client.setFanOnly();
      console.log('Confirmed fan-only.');
    }

    if (args.temp !== undefined && !Number.isNaN(args.temp)) {
      console.log(`\nSetting target temperature to ${args.temp}°...`);
      await client.setTargetTemperature(args.temp);
      console.log('Confirmed temperature.');
    }

    if (args.fan !== undefined && !Number.isNaN(args.fan)) {
      console.log(`\nSetting fan speed to ${args.fan}...`);
      await client.setFanSpeed(args.fan);
      console.log('Confirmed fan speed.');
    }
  } catch (err) {
    if (MagIQTouchClient.isAuthError(err)) {
      console.error('\nAUTH FAILED — check MQT_EMAIL / MQT_PASSWORD:', (err as Error).message);
    } else {
      console.error('\nError:', err);
    }
    process.exitCode = 1;
  } finally {
    await client.stop();
  }
}

void main();
