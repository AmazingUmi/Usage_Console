# Usage Console

本机运行的 AI 额度与 Token 用量看板，支持 Codex、Claude、Grok 和 Antigravity。

A local browser dashboard for AI quota, token usage, and estimated spend.

[中文](#中文) · [English](#english) · [发布指南 / Releasing](https://github.com/AmazingUmi/Usage_Console/blob/main/docs/RELEASING.md)

## 中文

### 安装与启动

需要 **Node.js 20+**，推荐 Node.js 22 / 24 LTS。直接通过 npm 安装，使用者不需要 pnpm 或源码目录：

```bash
npm install -g usage-console
usage-console
```

命令会打开浏览器，默认地址为 **http://127.0.0.1:3001**。

```bash
usage-console --port 4010          # 换一个本机端口
usage-console --no-open            # 不自动打开浏览器
usage-console --help
usage-console --version
```

在运行命令的终端按 **Ctrl+C** 停止服务。关闭网页不会停止后台进程；如果通过后台工具启动，请用相应工具停止。

从源码开发请参阅下方的[源码开发与本地打包](#源码开发与本地打包)。升级到最新版本：

```bash
npm install -g usage-console@latest
```

### 能做什么

- **额度看板**：添加 Codex、Claude、Grok 或 AGY 账户，查看服务商返回的额度、窗口和重置时间。没有添加的账户不占卡片。
- **本地用量**：扫描 Codex、Claude Code（含子代理）、Antigravity（桌面端 / IDE 与 CLI，含子代理）、Pi 和 Grok 会话；可查看今天、7 天、30 天或全部记录。不额外读取 Pi 用量账本，避免与会话重复计数。
- **趋势与明细**：输入、输出、缓存命中/写入、模型/渠道分布、最近请求、首 Token 等待与输出速度。
- **费用估算**：按内置模型单价估算 USD / CNY，供参考，不等同于服务商实际账单。
- **界面设置**：中文 / English、跟随系统或明暗主题、卡片排序、刷新间隔、电池颜色阈值、扫描路径及本机代理。

### 第一次使用

1. 本地用量与订阅登录无关，会自动扫描默认会话目录；路径不对时到「设置 → 路径」调整。
2. 在「设置 → 账户」添加额度账户：
   - **Codex / Grok**：官方设备码登录。
   - **Claude**：打开授权网页，完成后粘贴 code。
   - **AGY**：先在本机安装并登录 Antigravity CLI（`agy`），再添加 AGY 账户。控制台调用本机 `agy --print /usage`，不另存 AGY 登录。
3. 如需代理，到「设置 → 网络代理」保存本机 HTTP / 混合代理端口，然后重启服务。

默认用量路径：`~/.codex/sessions`、`~/.claude/projects`、`~/.gemini/antigravity/brain` 与 `~/.gemini/antigravity-cli/brain`、`~/.pi/agent/sessions`、`~/.grok/sessions`。Claude 也检测 `CLAUDE_CONFIG_DIR` 和系统配置目录中的 projects。

未登录的额度卡会提示登录；授权失效会清除旧读数。接口临时失败时，最多保留 10 分钟的旧读数，并标注其年龄。额度刷新默认每 2 分钟一次，可在设置中调整；过短可能触发服务商限流。

### 登录、数据与安全

**这是非官方客户端，不代表或隶属于任何服务商。** 发布和使用前应确认相关服务条款及授权范围。

- 配置默认保存在 `~/.usage-console/settings.json`；账户、凭据和用量缓存默认也在 `~/.usage-console/`，数据目录可在设置中修改。
- Codex、Claude 和 Grok 通过本应用独立授权，不借用或覆盖 Codex、Claude Code、Pi 的登录文件。本地用量扫描不需要这些订阅授权。
- 刷新令牌保存在数据目录的 **`credentials.json`，未加密**。在 POSIX 系统上以 `0600` 写入；Windows 用户应保护用户目录的访问权限。不要上传该文件，不要让多个运行实例共用同一份刷新令牌。
- **Claude 不是只读额度授权**：使用 Claude Code 的公开 client id，范围包括 `user:inference`、`user:profile`、`user:sessions:claude_code`、`user:mcp_servers`、`user:file_upload`。保存的令牌也具备推理、上传等能力；只有接受这些权限时才授权。
- 删除账户会移除本机保存的相应令牌；如需撤销服务商侧授权，应到对应服务商管理。
- 默认仅监听回环地址。API 不启用 CORS，并检查 Host、Origin 和浏览器 Fetch Metadata；不带这些浏览器头的本机客户端仍可使用。
- **API 没有登录鉴权，不要暴露到公网。** 非回环绑定必须显式使用 `--allow-remote` 或 `CONSOLE_ALLOW_REMOTE=1`。

| 配置 | 用途 |
| --- | --- |
| `--port` / `CONSOLE_PORT` | 监听端口，默认 `3001`；忽略 `PORT` |
| `--host` / `CONSOLE_HOST` | 绑定地址，默认 `127.0.0.1`；忽略 `HOST` |
| `--allow-remote` / `CONSOLE_ALLOW_REMOTE=1` | 允许非回环绑定，不会增加 API 鉴权 |
| `--no-open` | 不自动打开浏览器 |
| `CONSOLE_SETTINGS_PATH` | 使用独立配置文件；多实例还应配置独立 `dataDir` |

### 网络代理

- 设置面板接受 **HTTP / 混合代理端口**（1–65535），不支持纯 SOCKS；保存后需重启服务，刷新网页不够。
- 留空时沿用启动环境的 `HTTPS_PROXY` / `HTTP_PROXY`（兼容小写及 HTTP(S) 类型的 `ALL_PROXY`），否则直连。
- 代理用于服务端的额度查询、登录、续期，并传给 agy 子进程；这些请求使用本应用自己的 HTTP 客户端，不依赖 Node 的全局 fetch / dispatcher。
- 面板区分「已保存」与「进程实际生效」的设置；检测环境变量及 macOS 本机系统代理。端口检测只说明 TCP 是否可连接，不保证代理协议或外网可用。
- 回环地址始终绕过代理；已有 `NO_PROXY` 规则保留。不自动修改系统代理，不扫描未知端口。

### macOS 原生菜单栏

本项目的原生助手直接在 macOS 菜单栏显示额度圆环，不需要付费开发者证书或打包完整 `.app`。首次使用前安装 macOS Command Line Tools（`xcode-select --install`）；启动时会编译并缓存助手。

使用源码时，先安装下节的开发依赖并构建，再启动本机服务：

```bash
pnpm build
node bin/usage-console.js --no-open
```

另开一个终端启动菜单栏：

```bash
node bin/usage-console.js menubar
```

菜单栏助手独立运行，每 60 秒读取本机服务，相同参数重复启动只保留一个实例。安装包含此功能的 npm 版本后，可将上述 `node bin/usage-console.js` 替换为 `usage-console`；已发布的 npm 版本不一定包含此功能。

- 默认只显示第一个账户的 **16pt 空心圆环**。点击「显示账户」可勾选任意组合或选择「全部显示」，并自动保存选择；全部取消时保留一个中性虚线圆环，便于重新选择。
- 圆弧表示 5 小时 / 7 天窗口中较低的剩余比例；没有这些窗口时，使用其他可见窗口的最低值。未知值用虚线，警告用小圆点标记。
- 点击圆环查看账户、`5h` / `7d` 剩余百分比和重置倒计时。名称重复时附上邮箱标识；旧读数、登录失效、等待更新和服务离线仍会标记。AGY Claude 窗口的可见性沿用看板设置。
- 「打开完整看板」打开网页；「刷新显示」重新读取缓存。服务商额度查询遵循看板的刷新间隔（包括手动模式），立即查询请使用完整看板的刷新按钮。本地 Token 记录没有按订阅账户归属统计。

可追加以下选项：

| 选项 | 用途 |
| --- | --- |
| `--url http://127.0.0.1:4010` | 连接自定义端口，仅接受本机回环地址 |
| `--lang en` | 使用英文；默认 `zh` |
| `--account <account-id>` | 初始显示单个指定账户 |
| `--accounts all` / `--accounts '["id1","id2"]'` | 初始显示全部账户或指定组合；已保存的菜单选择优先。ID 可从本机 `/api/settings` 的 `accounts` 列表读取 |

**原生助手和 Usage Console 服务都必须保持运行。** 按 Ctrl+C 或关闭服务终端会停止服务；从下拉菜单选择「退出菜单栏」可关闭助手。`menubar --data` 输出助手读取的结构化 JSON，主要用于本机诊断。

### 源码开发与本地打包

开发建议使用 **Node.js 24**，以及 `package.json` 固定的 **pnpm 10.12.3**：

```bash
npm install -g pnpm@10.12.3
pnpm install --frozen-lockfile
pnpm dev
```

开发界面：http://localhost:3000；API：回环地址 `3001`。Vite 代理保留页面 Host，不绕过来源校验。

```bash
pnpm typecheck     # 前端、服务端及 TypeScript 测试
pnpm test          # 测试，包括干净源码 npm pack 与真实 Vite 代理
pnpm build
pnpm start         # 使用已编译的前后端，不需要 tsx 运行服务
```

本地 npm 包试装（以下为 macOS / Linux shell 命令）：

```bash
RELEASE_DIR="$(mktemp -d)"
pnpm release:pack "$RELEASE_DIR"    # prepack 自动清理并构建，输出 package.tgz
node scripts/smoke-package.mjs "$RELEASE_DIR/package.tgz"
```

smoke 脚本在临时目录仅安装生产依赖，使用隔离 HOME、不打开浏览器，检查命令、API 和前端资源后关闭服务并清理。`pnpm test` 的 HTTPS 代理用例用 `openssl` 生成临时证书，不关闭 TLS 验证；没有 openssl 时该用例会跳过。

### 自动检查与发布

- `ci.yml`：PR、main 分支和手动检查，配置覆盖 Linux / macOS / Windows，Node.js 20 / 22 / 24；包含类型、测试和生产依赖审计。
- `publish.yml`：推送 `v<package.json 版本>` 标签后，先通过 CI，再打包和独立安装验收，最后用 **npm Trusted Publishing / OIDC** 上传相同 tgz。
- 正式版使用 `latest`，预发布版（如 `v0.2.0-beta.1`）使用 `next`；不会在 PR 中发布，不需要 `NPM_TOKEN`。
- **必须先配置 npm 的 Trusted Publisher 和 GitHub `npm` environment。新增 workflow 本身不等于已经开通发布权限。**

首次手动发布、OIDC 配置、版本命令和重试规则见[发布指南](https://github.com/AmazingUmi/Usage_Console/blob/main/docs/RELEASING.md)。

## English

### Install and run

Requires **Node.js 20+**; Node.js 22 / 24 LTS is recommended. Install from npm; users do not need pnpm or a source checkout:

```bash
npm install -g usage-console
usage-console
```

The command opens **http://127.0.0.1:3001**. Use `--port 4010` to change the port, `--no-open` to skip the browser, and `--help` / `--version` for command information. Press **Ctrl+C** in the launching terminal to stop it; closing the browser does not stop the server.

To develop from source, see the development instructions above. Upgrade with `npm install -g usage-console@latest`.

### Features and setup

- Quota cards for Codex, Claude, Grok, and the local Antigravity CLI. Add only the accounts you need.
- Scan local Codex, Claude Code (including subagents), Antigravity (Desktop/IDE and CLI, including subagents), Pi, and Grok sessions. Pi's separate usage ledger is not read again.
- Token/cache trends, estimated USD/CNY spend, model/provider breakdowns, recent requests, time-to-first-token, and output speed. Estimated costs are not provider invoices.
- Chinese / English, system/light/dark themes, card ordering, configurable scan paths, quota refresh, and local HTTP proxy settings.

Local usage needs no subscription login. Add quota accounts under **Settings → Accounts**: Codex and Grok use device codes; Claude uses a browser authorization page and pasted code. For AGY, install and sign in to `agy` separately; this app runs `agy --print /usage` locally.

Quota refresh defaults to two minutes. Temporary provider failures may retain a clearly labeled reading for up to ten minutes; expired authorization clears old readings and asks for a new login.

### Security and data

**This is an unofficial client, not affiliated with the providers. Review their terms and the permissions you grant.**

- Settings default to `~/.usage-console/settings.json`; accounts, credentials, and usage cache default to `~/.usage-console/`. The data directory is configurable.
- Console logins do not read or overwrite Codex, Claude Code, or Pi login files. Usage scanning is separate from quota authorization.
- **Refresh tokens are unencrypted** in `credentials.json`. Writes use mode `0600` on POSIX; protect user-directory permissions on Windows. Never upload this file or share one refresh-token store between running instances.
- **Claude authorization is not quota-only.** It uses Claude Code's public client id with `user:inference`, `user:profile`, `user:sessions:claude_code`, `user:mcp_servers`, and `user:file_upload`. The saved token can also perform inference and uploads.
- Removing an account deletes its locally saved token; revoke provider-side grants at the provider if needed.
- The API has **no authentication**. Default binding is loopback, with Host/Origin/Fetch Metadata checks and no CORS. Non-loopback binding requires `--allow-remote` or `CONSOLE_ALLOW_REMOTE=1`; do not expose it publicly.
- `CONSOLE_PORT` / `CONSOLE_HOST` are supported; generic `PORT` / `HOST` are ignored. `CONSOLE_SETTINGS_PATH` selects another settings file; separate instances also need separate `dataDir` values.

### Native macOS menu bar

The project's native helper displays quota rings directly in the macOS menu bar. Install macOS Command Line Tools (`xcode-select --install`) before the first run; the helper is compiled and cached locally. No paid developer certificate or full `.app` bundle is required.

After installing the source dependencies described below, build and start the local service:

```bash
pnpm build
node bin/usage-console.js --no-open
```

In another terminal, launch the menu bar:

```bash
node bin/usage-console.js menubar
```

The helper runs independently, reads the local service every 60 seconds, and keeps one instance per argument set. This feature may not yet be in the published npm version; once installed from a release containing it, replace `node bin/usage-console.js` with `usage-console`.

By default, only the first account has a 16pt hollow ring. Use **Visible accounts** to check any subset or **Show all**; choices are saved. Clearing every checkbox leaves a neutral dashed placeholder so the menu can be reopened. Each arc shows the lower remaining quota of the 5-hour / 7-day windows, falling back to other visible windows when neither exists. Unknown values use a dashed ring; warnings add a dot. The compact click menu shows each account, `5h` / `7d` remaining percentages, and relative reset countdowns. Duplicate names receive an email identifier. AGY Claude visibility follows dashboard settings. **Open dashboard** and **Refresh display** remain available. Provider polling follows dashboard settings, including manual-only mode; use the dashboard to force a refresh. Local Token records are not attributed to subscription accounts.

Append `--url http://127.0.0.1:4010` for a custom loopback port or `--lang en` for English (default: `zh`). Set initial rings with `--account <account-id>`, `--accounts all`, or `--accounts '["id1","id2"]'`; saved menu choices take precedence. Account IDs are in `/api/settings` → `accounts`.

Keep the helper and local service running. Closing the service terminal or pressing Ctrl+C stops the service; **Quit menu bar** closes the helper. `menubar --data` prints the structured JSON consumed by the helper for local diagnostics.

### Proxy, development, and releasing

Set an HTTP or mixed-proxy port under **Settings → Network proxy**, then restart the server. Blank follows HTTP(S) proxy environment variables; SOCKS-only proxies are not supported. Loopback always bypasses the proxy and existing `NO_PROXY` rules remain. The panel distinguishes saved and active settings, and detects local macOS system proxies without changing them.

For development, Node.js 24 is recommended with the pinned pnpm 10.12.3:

```bash
pnpm install --frozen-lockfile
pnpm dev           # UI: localhost:3000; API: loopback:3001
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`prepack` cleans and rebuilds for `npm pack` and source publishing. `pnpm release:pack <directory>` produces `package.tgz`; `node scripts/smoke-package.mjs <tarball>` installs and runs it with an isolated HOME and cleans up afterward. HTTPS proxy tests use a temporary openssl certificate without disabling TLS checks; that case skips if openssl is unavailable.

GitHub Actions configures a Linux/macOS/Windows × Node 20/22/24 matrix. Version tags trigger validation, artifact installation checks, and a separate **OIDC-only publish job**. Stable versions use `latest`; prereleases use `next`. Configure the npm trusted publisher and GitHub `npm` environment before expecting publication. No `NPM_TOKEN` is required.

See the [release guide](https://github.com/AmazingUmi/Usage_Console/blob/main/docs/RELEASING.md) for bootstrap, setup fields, versioning, and recovery. Hosted CI, real provider logins, and browser behavior on each OS should be verified before claiming support beyond the checks actually run.

## Acknowledgements / 致谢

Inspired by [codex-switch](https://github.com/AmazingUmi/codex-switch) and [pi-quota-monitor](https://github.com/AmazingUmi/pi-quota-monitor).

## License

[MIT](LICENSE) © AmazingUmi
