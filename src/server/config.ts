import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();

export const CONFIG = {
  port: parseInt(process.env.CONSOLE_PORT || (process.env.PORT && process.env.PORT !== '30141' ? process.env.PORT : '3001'), 10),
  host: process.env.HOST || '127.0.0.1',
  paths: {
    home: HOME,
    codex: path.join(HOME, '.codex'),
    codexSessions: path.join(HOME, '.codex', 'sessions'),
    codexAuth: path.join(HOME, '.codex', 'auth.json'),
    pi: path.join(HOME, '.pi'),
    piAgent: path.join(HOME, '.pi', 'agent'),
    piQuotaMonitor: path.join(HOME, '.pi', 'agent', 'pi-quota-monitor'),
    piQuotaReadings: path.join(HOME, '.pi', 'agent', 'pi-quota-monitor', 'quota-readings'),
    piUsage: path.join(HOME, '.pi', 'agent', 'pi-quota-monitor', 'usage'),
    gemini: path.join(HOME, '.gemini'),
  },
};
