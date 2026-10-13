import { resolveRuntimePaths } from './settings.js';

export const CONFIG = {
  port: parseInt(process.env.CONSOLE_PORT || (process.env.PORT && process.env.PORT !== '30141' ? process.env.PORT : '3001'), 10),
  host: process.env.HOST || '127.0.0.1',
  get paths() {
    return resolveRuntimePaths();
  },
};
