/**
 * Bind address for the local console.
 * `HOST` and `PORT` are ignored: those variables are commonly set by other tools,
 * and this process stores OAuth refresh tokens with no request authentication.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return LOOPBACK.has(normalized);
}

/** Host header hostname, without a port. Bracketed IPv6 is unwrapped. */
export function hostnameFromHostHeader(header: string | undefined): string | null {
  if (!header) return null;
  const value = header.trim();
  if (!value) return null;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? null : value.slice(1, end);
  }
  const colon = value.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(value.slice(colon + 1))) return value.slice(0, colon);
  return value;
}

export function isLoopbackRequestHost(header: string | undefined): boolean {
  const host = hostnameFromHostHeader(header);
  return host != null && isLoopbackHost(host);
}

export function resolveListenPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CONSOLE_PORT;
  if (raw == null || raw === '') return 3001;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid CONSOLE_PORT: ${raw}`);
  }
  return port;
}

export function allowsRemoteBind(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONSOLE_ALLOW_REMOTE === '1';
}

/** Node wants `::1`, not `[::1]`. */
export function normalizeBindHost(host: string): string {
  const trimmed = host.trim();
  const lower = trimmed.toLowerCase();
  if (lower === '[::1]') return '::1';
  if (lower === '[::]') return '::';
  return trimmed;
}

export function resolveListenHost(env: NodeJS.ProcessEnv = process.env): string {
  const host = normalizeBindHost(env.CONSOLE_HOST || '127.0.0.1') || '127.0.0.1';
  if (isLoopbackHost(host) || allowsRemoteBind(env)) return host;
  throw new Error(
    `拒绝绑定 ${host}：本控制台没有登录鉴权，默认只监听本机回环地址。\n`
    + `Refusing to bind ${host}: this console has no authentication and only listens on loopback unless --allow-remote is set.`,
  );
}

/** A URL a browser can open. Wildcard binds are not useful as a host. */
export function browserUrl(host: string, port: number): string {
  const browse = host === '0.0.0.0' || host === '::' || host === '[::]' ? '127.0.0.1' : host;
  const formatted = browse.includes(':') && !browse.startsWith('[') ? `[${browse}]` : browse;
  return `http://${formatted}:${port}`;
}
