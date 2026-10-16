import { execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { loadSettings } from '../settings.js';
import { describeProxy, isLoopback, parseMacSystemProxy, resolveProxyEnvironment } from './proxy-config.js';
import type { ProxyEndpoint, ProxyRuntime, ProxyStatus } from './proxy-config.js';

const execFileAsync = promisify(execFile);
let runtime: ProxyRuntime | null = null;
let dispatcher: EnvHttpProxyAgent | null = null;

/** Called once, before any quota/auth requests. Settings saves deliberately do not reconfigure live connections. */
export function initializeProxy(): void {
  if (runtime) return;
  const resolved = resolveProxyEnvironment(loadSettings().proxyPort, process.env);
  // Own the transport instead of relying on Node's global fetch/dispatcher, whose API and initialization vary.
  dispatcher = new EnvHttpProxyAgent({
    httpProxy: resolved.httpProxy,
    httpsProxy: resolved.httpsProxy,
    noProxy: resolved.noProxy,
  });

  // Local helpers such as agy inherit the same proxy, including when lower-case variables previously disagreed.
  if (resolved.configuredPort !== null) {
    for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
      process.env[key] = resolved.httpProxy;
    }
    process.env.NODE_USE_ENV_PROXY = '1';
  }
  process.env.NO_PROXY = process.env.no_proxy = resolved.noProxy;
  runtime = resolved;
  const proxy = resolved.active;
  console.log(proxy
    ? `[Proxy] ${proxy.source}: ${proxy.host}:${proxy.port} (explicit request dispatcher; restart to change)`
    : '[Proxy] direct connection (no HTTP proxy configured)');
}

/** All provider, login and token-refresh requests use this dispatcher explicitly, without startup flags. */
export function proxyFetch(
  input: Parameters<typeof undiciFetch>[0],
  init: Parameters<typeof undiciFetch>[1] = {},
): ReturnType<typeof undiciFetch> {
  initializeProxy();
  return undiciFetch(input, { ...init, dispatcher: dispatcher! });
}

let systemCache: { at: number; proxy: ProxyEndpoint | null } | null = null;
let detecting: Promise<ProxyEndpoint | null> | null = null;

async function detectSystemProxy(): Promise<ProxyEndpoint | null> {
  if (process.platform !== 'darwin') return null;
  if (systemCache && Date.now() - systemCache.at < 10_000) return systemCache.proxy;
  if (detecting) return detecting;
  detecting = (async () => {
    let proxy: ProxyEndpoint | null = null;
    try {
      const { stdout } = await execFileAsync('/usr/sbin/scutil', ['--proxy'], { timeout: 1000, maxBuffer: 32 * 1024 });
      proxy = parseMacSystemProxy(stdout);
    } catch {
      // Detection is advisory; an unavailable system command must not break settings or proxy requests.
    }
    systemCache = { at: Date.now(), proxy };
    return proxy;
  })().finally(() => { detecting = null; });
  return detecting;
}

function isListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: host.replace(/^\[|\]$/g, ''), port });
    const finish = (listening: boolean) => { socket.destroy(); resolve(listening); };
    socket.setTimeout(800);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  initializeProxy();
  const active = runtime!;
  const environment = active.environment && isLoopback(active.environment.host) ? active.environment : null;
  const detected = await detectSystemProxy() ?? environment;
  const configuredPort = loadSettings().proxyPort;
  const status = describeProxy(active, configuredPort, detected);
  if (status.checkedPort !== null) {
    const host = configuredPort !== null ? '127.0.0.1' : active.environment!.host;
    status.listening = await isListening(host, status.checkedPort);
  }
  return status;
}
