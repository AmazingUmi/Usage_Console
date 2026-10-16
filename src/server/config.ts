import { resolveListenHost, resolveListenPort } from './listen.js';
import { resolveRuntimePaths } from './settings.js';

export const CONFIG = {
  get port() {
    return resolveListenPort();
  },
  get host() {
    return resolveListenHost();
  },
  get paths() {
    return resolveRuntimePaths();
  },
};
