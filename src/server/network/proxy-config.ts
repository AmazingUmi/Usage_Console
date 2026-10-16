/** Pure proxy configuration helpers. Raw URLs may contain credentials and must never reach the browser. */
export interface ProxyEndpoint {
  source: 'settings' | 'environment' | 'system';
  host: string;
  port: number;
}

export interface ProxyRuntime {
  configuredPort: number | null;
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
  active: ProxyEndpoint | null;
  environment: ProxyEndpoint | null;
}

export interface ProxyStatus {
  active: ProxyEndpoint | null;
  detected: ProxyEndpoint | null;
  restartRequired: boolean;
  portMismatch: boolean;
  checkedPort: number | null;
  listening: boolean | null;
}

export function validProxyPort(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535);
}

export function isLoopback(host: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase());
}

function endpoint(raw: string, source: ProxyEndpoint['source']): ProxyEndpoint | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { source, host: url.hostname, port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80) };
  } catch {
    return null;
  }
}

export function resolveProxyEnvironment(port: number | null, env: NodeJS.ProcessEnv): ProxyRuntime {
  const allValue = env.all_proxy || env.ALL_PROXY || '';
  const all = endpoint(allValue, 'environment') ? allValue : '';
  const http = env.http_proxy || env.HTTP_PROXY || all;
  const https = env.https_proxy || env.HTTPS_PROXY || http;
  const local = port === null ? null : `http://127.0.0.1:${port}`;
  const httpProxy = local ?? http;
  const httpsProxy = local ?? https;
  const noProxy = [...new Set([
    ...(env.no_proxy || env.NO_PROXY || '').split(',').map((item) => item.trim()).filter(Boolean),
    'localhost', '127.0.0.1', '::1', '[::1]',
  ])].join(',');
  return {
    configuredPort: port,
    httpProxy,
    httpsProxy,
    noProxy,
    active: endpoint(httpsProxy || httpProxy, local ? 'settings' : 'environment'),
    environment: endpoint(https || http, 'environment'),
  };
}

/** Only enabled HTTP(S) loopback proxies can be adopted by our local-port setting. PAC/SOCKS are not HTTP proxies. */
export function parseMacSystemProxy(output: string): ProxyEndpoint | null {
  for (const prefix of ['HTTPS', 'HTTP']) {
    const read = (key: string) => output.match(new RegExp(`^\\s*${prefix}${key}\\s*:\\s*(\\S+)\\s*$`, 'm'))?.[1];
    const host = read('Proxy');
    const port = Number(read('Port'));
    if (read('Enable') === '1' && host && isLoopback(host) && validProxyPort(port)) {
      return { source: 'system', host, port };
    }
  }
  return null;
}

export function describeProxy(runtime: ProxyRuntime, configuredPort: number | null, detected: ProxyEndpoint | null): ProxyStatus {
  // When clearing a saved override, check the environment that the next startup will inherit, not the old override.
  const environmentPort = runtime.environment && isLoopback(runtime.environment.host) ? runtime.environment.port : null;
  const checkedPort = configuredPort ?? environmentPort;
  return {
    active: runtime.active,
    detected,
    restartRequired: configuredPort !== runtime.configuredPort,
    portMismatch: checkedPort !== null && detected !== null && checkedPort !== detected.port,
    checkedPort,
    listening: null,
  };
}
