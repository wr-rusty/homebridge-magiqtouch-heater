import type { API } from 'homebridge';

import { PLATFORM_NAME } from './settings.js';
import { MagIQTouchPlatform } from './platform.js';

/**
 * Homebridge entry point — registers the dynamic platform.
 */
export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, MagIQTouchPlatform);
};
