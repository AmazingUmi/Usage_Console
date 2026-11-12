import { Console } from 'node:console';
import { normalizeBindHost } from './listen.js';
import { parseMenuBarArgs, readJson } from './menubar.js';

async function probeConsole(origin: string): Promise<boolean> {
  try {
    const health = await readJson(new URL('/api/health', origin), 1000) as {
      status?: unknown;
      app?: unknown;
      time?: unknown;
    } | null;
    if (health?.status === 'ok' && health.app === 'usage-console') return true;
    // Versions through 0.1.1 identify themselves by the health and quota response shapes.
    if (health?.status === 'ok' && typeof health.time === 'number' && health.app === undefined) {
      const quota = await readJson(new URL('/api/quota', origin), 5000) as {
        providers?: unknown;
        refreshIntervalSeconds?: unknown;
      } | null;
      if (quota?.providers && typeof quota.providers === 'object' && !Array.isArray(quota.providers)
        && typeof quota.refreshIntervalSeconds === 'number') return true;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') return false;
    throw new Error(`Usage Console health check failed at ${origin}: ${(error as Error).message}`);
  }
  throw new Error(`The address ${origin} is occupied by another service.`);
}

async function startService(origin: string): Promise<'owned' | 'reused'> {
  if (await probeConsole(origin)) return 'reused';
  const url = new URL(origin);
  process.env.CONSOLE_HOST = normalizeBindHost(url.hostname);
  process.env.CONSOLE_PORT = url.port || '80';
  process.env.CONSOLE_ALLOW_REMOTE = '0';
  try {
    const { startServer } = await import('./index.js');
    await startServer();
    return 'owned';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && await probeConsole(origin)) return 'reused';
    throw error;
  }
}

// This entry point is started by the Swift helper. Its stdin pipe closes even if the helper crashes.
// Keep stdout reserved for the startup result.
globalThis.console = new Console(process.stderr);
process.stdin.once('end', () => process.exit(0)).resume();
try {
  const { url } = parseMenuBarArgs(['--url', process.argv[2]]);
  if (!url.startsWith('http:')) throw new Error('The managed service requires a loopback HTTP URL.');
  const status = await startService(url);
  process.stdout.write(`${status}\n`);
  if (status === 'reused') process.stdin.pause();
} catch (error) {
  const message = (error as Error).message.replace(/[\r\n]+/g, ' ').slice(0, 2000);
  process.stdout.write(`Could not start the local service: ${message}\n`);
  process.exitCode = 1;
  process.stdin.pause();
}
