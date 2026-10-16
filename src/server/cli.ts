import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allowsRemoteBind, isLoopbackHost } from './listen.js';

export interface CliOptions {
  help: boolean;
  version: boolean;
  open: boolean;
  allowRemote: boolean;
  port?: number;
  host?: string;
}

const HELP = `usage-console

本机额度与用量控制台。启动后在浏览器打开。
Local quota and usage console. Opens a browser after start.

Usage:
  usage-console [--port 3001] [--host 127.0.0.1] [--no-open]

Options:
  --port <1-65535>   Listen port (default 3001, or CONSOLE_PORT). PORT is ignored.
  --host <addr>      Bind address (default 127.0.0.1, or CONSOLE_HOST). HOST is ignored.
  --allow-remote     Allow a non-loopback bind (or CONSOLE_ALLOW_REMOTE=1). No authentication.
  --no-open          Do not open a browser
  --version          Print version
  --help             Show this help
`;

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const opts: CliOptions = { help: false, version: false, open: true, allowRemote: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-V') opts.version = true;
    else if (arg === '--no-open') opts.open = false;
    else if (arg === '--allow-remote') opts.allowRemote = true;
    else if (arg === '--port' || arg.startsWith('--port=')) opts.port = readPort(takeValue(arg, argv, i));
    else if (arg === '--host' || arg.startsWith('--host=')) opts.host = takeValue(arg, argv, i);
    else throw new Error(`Unknown argument: ${arg}`);
    if (arg === '--port' || arg === '--host') i += 1;
  }
  if (opts.host && !opts.allowRemote && !allowsRemoteBind(env) && !isLoopbackHost(opts.host)) {
    throw new Error(
      `拒绝绑定 ${opts.host}：本控制台没有登录鉴权，默认只监听本机回环地址。要监听其他地址请加上 --allow-remote。\n`
      + `Refusing to bind ${opts.host}: this console has no authentication. Pass --allow-remote to listen beyond loopback.`,
    );
  }
  return opts;
}

function takeValue(arg: string, argv: string[], index: number): string {
  const inline = arg.indexOf('=');
  const value = inline >= 0 ? arg.slice(inline + 1) : argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg.split('=')[0]}`);
  return value;
}

function readPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${value}`);
  return port;
}

export function packageVersion(fromDir = path.dirname(fileURLToPath(import.meta.url))): string {
  const file = path.resolve(fromDir, '../../package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string };
  return pkg.version || '0.0.0';
}

export function openBrowser(url: string): void {
  const child = process.platform === 'darwin'
    ? spawn('open', [url], { stdio: 'ignore', detached: true })
    : process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true, windowsHide: true })
      : spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
  child.on('error', () => {
    console.error(`Could not open a browser. Open ${url} yourself.`);
  });
  child.unref();
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error((err as Error).message);
    console.error('Run usage-console --help');
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.version) {
    console.log(packageVersion());
    return;
  }
  if (opts.port) process.env.CONSOLE_PORT = String(opts.port);
  if (opts.host) process.env.CONSOLE_HOST = opts.host;
  if (opts.allowRemote) process.env.CONSOLE_ALLOW_REMOTE = '1';

  try {
    const { startServer } = await import('./index.js');
    const started = await startServer();
    console.log(`Usage Console  ${started.url}`);
    if (!started.clientBuilt) {
      console.error('前端尚未构建，只能访问 API。请先执行 pnpm build。\nUI is not built; only the API is available. Run pnpm build.');
    } else if (opts.open) {
      openBrowser(started.url);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      console.error(`端口 ${opts.port ?? process.env.CONSOLE_PORT ?? 3001} 已被占用。\nPort already in use.`);
    } else {
      console.error((err as Error).message || err);
    }
    process.exitCode = 1;
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
