import { PLATFORM_NAME } from './settings.js';
import { MagIQTouchPlatform } from './platform.js';
/**
 * Homebridge entry point — registers the dynamic platform.
 */
export default (api) => {
    api.registerPlatform(PLATFORM_NAME, MagIQTouchPlatform);
};
//# sourceMappingURL=index.js.map