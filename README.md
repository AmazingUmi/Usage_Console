# Usage Console

[中文](#中文) · [English](#english)

轻量级多平台 AI 额度查询与 Token 用量监控控制台（B/S 架构）。

A local browser console for AI quota and token usage.

---

## 中文

结合了 [codex-switch](https://github.com/AmazingUmi/codex-switch) 的无侵入式用量洞察与 [pi-quota-monitor](https://github.com/AmazingUmi/pi-quota-monitor) 的多平台额度监控协议，为开发者提供一体化的额度状态和开销仪表盘。

### 特性

- **官方额度实时监控**：
  - **Antigravity / Gemini**：5小时限额与每周配额进度条、模型分组、自动重置倒计时。
  - **OpenAI Codex**：订阅类型（Plus / Pro）、5小时滚动限额及周额度。
  - **xAI Grok / Claude**：配额窗口与探活状态。
- **无感本地用量统计**：
  - 自动读取并同步本地会话记录（如 `~/.codex/sessions`、`~/.claude/projects`、Pi sessions）。不读取 Pi 用量账本，避免和会话重复计数。
  - 支持多时间跨度筛选（今天、近7天、近30天、全部记录）。
- **费用与时序可视化**：
  - 消耗总 Token、输入/输出细分、缓存命中量、推理输出。
  - 内置主流模型官方价格表，自动估算美元与人民币消费。
  - 多序列用量折线图：输入、输出、缓存创建、缓存命中，以及右侧坐标的估算费用。
  - 按模型（By Model）与按渠道（By Provider）的占比分布与排序明细。
  - 最近请求历史流水表。
- **设置**：
  - 与额度、趋势、用量同页。顶栏「设置」可展开或收起。
  - 额度卡只显示已添加的账户。添加时选择 GPT、Claude、Grok 或 AGY，未添加不占位。
  - 可隐藏 Antigravity 的 Claude 额度分组，且不影响用量统计与显示。
  - 可设置本机 HTTP / 混合代理端口，保存后重启服务生效；显示当前生效代理，检测环境变量及 macOS 本机系统代理，并提醒端口不一致或无法连接。
  - 可配置 Codex、Pi、Claude 对话和 Grok 的本地扫描路径。
  - 扫描 Claude Code 本地对话 JSONL（含子代理），并按消息去重。

### 界面

- 「剩余额度」区域名称带一个液态玻璃胶囊，右侧是两个圆形图标按钮：添加账户（＋）和账户设置（滑块）；未登录或登录失效的卡片上有「去登录」，会直接打开对应类型的登录。
- 模块、标题胶囊与内层卡片的圆角按实际间距推导（外半径 = 内半径 + 内边距 + 边框），收起的设置模块上下留白对称，窄屏也保持同圆心的嵌套轮廓。
- 页面分为四个「模块」（额度、用量、明细、设置）：每个模块是一整块液态玻璃，标题在顶部，下面用细线隔开；模块里的卡片、表格是不模糊的扁平小块，玻璃不嵌套。各处说明文字收进标题旁的「?」，悬停或聚焦显示，点击可固定，Esc 关闭。
- 顶栏右侧是三个同尺寸的圆形：连接状态（呼吸灯，悬停显示状态和更新时间）、主题按钮（点一下依次切换：跟随系统 → 日间 → 夜间，保存在当前浏览器）、刷新按钮。
- 额度卡片右上角是刷新倒计时（玻璃圆环，显示距下次自动读取额度的时间，如 `2m`、`45s`；悬停显示具体时刻）、铅笔（编辑账户）和状态灯。
- 卡片可以换位置：拖动整张卡片，或聚焦左上角的服务商图标后按 ← →；顺序保存在账户列表里，刷新后保持。
- 每张卡片里的窗口统一按时长从短到长排列（5 小时在前，每周在后），与服务商返回的顺序无关。
- 「设置」模块里每一项（账户、显示项、路径、扫描来源）都是独立的分块，卡片整行铺满。
- 每个模块有推荐高度：明细表和分布列表在固定区域内滚动，切换标签、时间范围、维度、图表类型时页面不会跳动；窄屏堆叠时按内容自适应。
- 每日趋势有柱状和折线两种图（折线含输入、输出、缓存命中、缓存写入四条线，点图例可隐藏某条线）。
- 卡片状态只用呼吸灯表示（绿：正常，黄：注意，红：异常，灰：未连接），鼠标悬停显示文字。重置倒计时用 `1h50m`、`2d3h` 样式。
- 「设置 → 显示」里：
  - 语言：中文 / English，只保存在当前浏览器。
  - 电池颜色：拖动两个把手设置颜色分界（默认：≤50% 变黄，≤10% 变红），也可用方向键微调。
  - 额度刷新间隔：30 秒 / 1 / 2（默认）/ 5 / 10 分钟、仅手动，或自定义 30–3600 秒。过短可能触发官方接口限流。
- 额度卡片的状态（参考 codex-switch 的逻辑）：
  - 没有登录的账户立刻显示「未登录」+「去登录」，不用等读数。
  - 读数还没回来时显示「获取中…」，每 3 秒重试直到有结果；本地服务连不上时显示连接错误并自动重试。
  - 登录被撤销或刷新令牌被拒绝：显示「需重新登录」，并立即清掉旧读数。
  - 官方接口临时失败或限流：最多 10 分钟内继续显示上次的读数，变淡并标注「N 分钟前的读数」；超过 10 分钟后只显示错误。
- Antigravity 不需要在控制台登录：控制台直接运行本机的 `agy --print /usage`，用 agy 自己的登录读取额度（实现参考 pi-quota-monitor 的本机模式）。本机装好并登录 agy 后，在「添加账户」里选 AGY 即可。

### 订阅账号：在控制台独立登录（OpenAI / Claude / Grok）

- 在「设置 → 账户 → 添加」里选类型并认证登录：OpenAI、Grok 走官方设备码，Claude 走网页授权后粘贴 code。
- 登录令牌（未加密，文件权限 0600）保存在数据目录的 `credentials.json`，由本应用自行续期。这是一份独立授权，刷新它不会让 Codex、Claude Code、pi 掉线，也不依赖它们。
- Claude 必须在浏览器打开官方授权页并粘贴 code，不会静默读取已有登录。这是非官方客户端，使用 Claude Code 的公开 client id，申请的范围是 `user:inference`、`user:profile`、`user:sessions:claude_code`、`user:mcp_servers`、`user:file_upload`，不是只读额度。保存的刷新令牌因此也能调用推理和上传。
- 订阅账号读额度只使用这份独立登录，不再读取 `~/.codex/auth.json`、macOS 钥匙串里的 Claude Code 登录或 pi 的登录。账户名称取自账户设置里的备注名或邮箱。
- 账户库里有、但还没登录的账户显示「未登录」卡片，提示去添加账户；删除账户会同时清除它的令牌。
- 本机 token 用量与登录无关，仍直接扫描本地 session。

### 快速开始

#### 1. 安装依赖

需要 Node.js 20+ 与 pnpm：

```bash
pnpm install
```

#### 2. 开发模式

同时启动 Vite 开发服务器（端口 3000）与 Node API 服务（端口 3001）：

```bash
pnpm dev
```

在浏览器中打开：[http://localhost:3000](http://localhost:3000)

#### 3. 生产模式构建与运行

编译前端和服务端，然后用本机命令启动。它会在浏览器打开控制台：

```bash
pnpm build
pnpm start
```

默认只监听 [http://127.0.0.1:3001](http://127.0.0.1:3001)。`--port` 或 `CONSOLE_PORT` 改端口，不读取 `PORT`。`--host` 或 `CONSOLE_HOST` 改绑定地址，忽略 `HOST`。非回环地址必须再加 `--allow-remote`（或 `CONSOLE_ALLOW_REMOTE=1`），此时 API 没有登录鉴权。`--no-open` 不打开浏览器。服务只给同源页面用，不开启 CORS；API 会校验 `Origin` 和浏览器的 `Sec-Fetch-Site`，拒绝跨源请求（包括其他本机端口），仍支持不带这些浏览器头的本机客户端。开发代理保留原始 Host，无需放宽来源校验。绑在回环地址时，还会拒绝 Host 不是 `localhost` / `127.0.0.1` / `::1` 的请求。

发布到 npm 之后（尚未发布），安装方式是：

```bash
npm install -g usage-console
usage-console
```

### 网络代理

在「设置 → 网络代理」填写本机的 **HTTP / 混合代理端口**（例如 `7897`，范围 1–65535，不支持纯 SOCKS 端口），点击保存后**重启本地服务**。刷新网页不会应用新配置。代理用于服务端的额度查询、OAuth 登录和令牌续期，也传递给本机 agy 子进程。

- 留空：沿用启动时的 `HTTPS_PROXY` / `HTTP_PROXY`（也支持小写及 HTTP(S) 类型的 `ALL_PROXY`）；均未配置则直连。服务端所有额度、登录和续期请求使用独立 HTTP 客户端，每次请求显式指定代理，不依赖 Node 的全局 `fetch`、全局 dispatcher 或 `NODE_USE_ENV_PROXY`。保存端口后直接 `pnpm start` 即可，无需手写环境变量前缀；启动日志会显示实际代理及配置来源。
- 设置面板显示当前进程实际使用的代理，与已保存、等待重启的设置分开显示。
- 检测环境变量和 macOS 系统中启用的本机 HTTP(S) 代理；与配置端口不一致时提醒，可一键填入检测端口后保存。其他系统仍可检测环境变量，不扫描未知端口，也不会自动修改配置。
- 连接检查仅检查本机 TCP 端口，不代表代理协议正确或外网接口一定可达。系统代理检测不支持 PAC 或纯 SOCKS。
- `localhost` / `127.0.0.1` / `::1` 始终绕过代理；原有 `NO_PROXY` 规则保留。

### 测试

```bash
pnpm test
```

HTTPS 代理回归测试会用系统 `openssl` 在临时目录生成测试证书，通过 `NODE_EXTRA_CA_CERTS` 仅信任该证书，不关闭 TLS 验证；未安装 `openssl` 时跳过该项。测试移除所有代理环境变量，并禁用全局 `fetch` / 全局 dispatcher，验证额度、登录、令牌续期仍显式经过已保存的代理端口。

回归测试还覆盖 CLI 启动失败后及时退出、环境变量与参数组合、跨源 API 拒绝及真实 Vite 代理。打包测试从没有 `dist` 的临时源码快照执行 `npm pack`，确认包含 CLI 和前端资源。`prepack` 会自动运行 `pnpm build`，因此打包与从源码发布都会先清理并重建。

### 目录结构

```text
Usage_Console/
├── bin/usage-console.js      # 已发布命令的入口
├── package.json
├── vite.config.ts            # 前端 Vite 构建与开发代理
├── src/client/               # React 看板
└── src/server/               # 本机 API、CLI、登录、额度与用量
    ├── cli.ts                # 命令行参数与启动
    ├── listen.ts             # 只监听回环地址，除非显式允许远程
    ├── identity/             # 独立 OAuth 登录与令牌续期
    ├── quota/                # Codex、Claude、Grok 与本机 agy 额度
    └── usage/                # 本地会话扫描、定价与聚合
```

---

## English

It combines the non-invasive usage insight of [codex-switch](https://github.com/AmazingUmi/codex-switch) with the multi-provider quota protocol of [pi-quota-monitor](https://github.com/AmazingUmi/pi-quota-monitor). One local dashboard shows quota state and estimated spend.

### Features

- **Live official quota**:
  - **Antigravity / Gemini**: 5-hour and weekly quota bars, model groups, and reset countdowns.
  - **OpenAI Codex**: plan (Plus / Pro), rolling 5-hour limit, and weekly quota.
  - **xAI Grok / Claude**: quota windows and reachability.
- **Local usage, without a separate ledger**:
  - Reads and syncs local session logs (`~/.codex/sessions`, `~/.claude/projects`, Pi sessions). It does not read the Pi usage ledger, so those sessions are not counted twice.
  - Filter by today, last 7 days, last 30 days, or all history.
- **Cost and time charts**:
  - Total tokens, input and output, cache hits, and reasoning output.
  - Built-in public price table, with estimated cost in USD and CNY.
  - A multi-series chart for input, output, cache creation, cache hits, and estimated cost on the right axis.
  - Share and ranked detail by model and by provider.
  - A recent-request history.
- **Settings**:
  - On the same page as quota, trend, and usage. The header control expands or collapses it.
  - Quota cards appear only for accounts you add. Choose GPT, Claude, Grok, or AGY; unused providers do not leave empty cards.
  - Hide the Claude group inside Antigravity without changing usage statistics.
  - Set a local HTTP or mixed-proxy port. It applies after the local server restarts. The panel shows the proxy actually in use, checks environment variables and the macOS system proxy, and warns when the port differs or is not accepting connections.
  - Configure the local scan paths for Codex, Pi, Claude conversations, and Grok.
  - Scan Claude Code JSONL transcripts, including subagents, and dedupe by message.

### Interface

- The “remaining quota” title sits in a liquid-glass capsule. Two round icon buttons on the right add an account and open account settings. A signed-out or expired card has “Sign in”, which opens that provider’s login.
- Corner radii are derived from the real gap: outer radius = inner radius + padding + border. A collapsed settings module has symmetric vertical space, and narrow screens keep the same nested outline.
- The page has four modules (quota, usage, detail, settings). Each module is one glass slab, with the title on top and a hairline below. Cards and tables inside are flat and not blurred; glass is not nested. Explanations live in the “?” beside a title. Hover or focus shows it, click pins it, and Esc closes it.
- The header has three equal circles: connection status (a breathing light; hover shows status and update time), theme (system, day, night, stored in this browser), and refresh.
- A quota card’s top-right has a refresh countdown (a glass ring such as `2m` or `45s`; hover shows the clock time), a pencil to edit the account, and a status light.
- Reorder cards by dragging one, or by focusing the provider icon and pressing Left / Right. The order is stored with the account list.
- Windows inside a card are always ordered from shortest to longest (5-hour before weekly), regardless of the provider’s response order.
- Each settings block (accounts, display, paths, scan sources) is its own full-width row.
- Each module has a preferred height. Detail tables and distribution lists scroll inside that area, so changing tabs, range, dimension, or chart type does not jump the page. Narrow screens stack to content height.
- The daily trend is a bar chart or a line chart. The line chart has input, output, cache hits, and cache writes; click a legend entry to hide that series.
- Card status is only a breathing light: green ok, amber attention, red error, gray disconnected. Hover shows the text. Reset countdowns use forms such as `1h50m` and `2d3h`.
- Under Settings → Display:
  - Language: 中文 / English, stored only in this browser.
  - Battery colors: drag two handles (default: amber at or below 50%, red at or below 10%). Arrow keys nudge them.
  - Quota refresh: 30 seconds, 1, 2 (default), 5, or 10 minutes, manual only, or a custom 30–3600 seconds. A short interval can trip provider rate limits.
- Quota-card states, following the codex-switch rules:
  - An account with no login shows “Signed out” and “Sign in” immediately. It does not wait for a reading.
  - Before the first reading it shows “Fetching…”, and retries every 3 seconds. If the local server is down, it shows a connection error and retries.
  - A revoked login or rejected refresh token shows “Sign in again” and clears the old reading at once.
  - A temporary provider failure or rate limit keeps the last reading for up to 10 minutes, dimmed and labeled “reading from N minutes ago”. After 10 minutes only the error remains.
- Antigravity does not log in through this console. The server runs the local `agy --print /usage` command and uses agy’s own login. This follows pi-quota-monitor’s local mode. Install and sign in to agy, then add an AGY account.

### Subscription accounts: sign in inside the console (OpenAI / Claude / Grok)

- Under Settings → Accounts → Add, pick a type and authenticate. OpenAI and Grok use the official device-code flow. Claude uses a browser authorization page, then you paste the code.
- The login token is stored unencrypted, mode 0600, in `credentials.json` under the data directory. This app renews it. The grant is independent: refreshing it does not sign Codex, Claude Code, or pi out, and does not depend on them.
- Claude always requires the official browser page and a pasted code. It never silently reads an existing login. This is an unofficial client. It uses Claude Code’s public client id and requests `user:inference`, `user:profile`, `user:sessions:claude_code`, `user:mcp_servers`, and `user:file_upload`, not a quota-only scope. The stored refresh token can therefore call inference and upload files, not only read quota.
- Quota reads use only this independent login. They do not read `~/.codex/auth.json`, the Claude Code login in the macOS keychain, or pi’s login. The account name comes from the note or email in account settings.
- An account that is listed but not signed in shows a “Signed out” card and points you to Add account. Deleting an account also deletes its token.
- Local token usage does not depend on login. It is still scanned from local sessions.

### Quick start

#### 1. Install dependencies

Node.js 20+ and pnpm:

```bash
pnpm install
```

#### 2. Development

Start the Vite dev server (port 3000) and the Node API (port 3001):

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

#### 3. Production build and run

Build the UI and server, then start the local command. It opens the console in a browser:

```bash
pnpm build
pnpm start
```

By default it listens only on [http://127.0.0.1:3001](http://127.0.0.1:3001). Change the port with `--port` or `CONSOLE_PORT`; `PORT` is ignored. Change the bind address with `--host` or `CONSOLE_HOST`; `HOST` is ignored. A non-loopback address also requires `--allow-remote` (or `CONSOLE_ALLOW_REMOTE=1`). In that mode the API has no authentication. `--no-open` skips the browser. The server is for the same-origin page only and does not enable CORS. The API checks `Origin` and the browser's `Sec-Fetch-Site`, rejecting cross-origin requests, including other local ports. Local clients without these browser headers remain supported. The development proxy preserves the original Host, so no origin-check bypass is needed. While bound to loopback, it also rejects requests whose Host is not `localhost`, `127.0.0.1`, or `::1`.

After it is published to npm (not published yet):

```bash
npm install -g usage-console
usage-console
```

### Network proxy

Under Settings → Network proxy, enter the local **HTTP or mixed-proxy port** (for example `7897`, range 1–65535; a SOCKS-only port is not supported). Save, then **restart the local server**. Reloading the page does not apply the new setting. The proxy is used for quota queries, OAuth login, and token refresh, and is passed to the local agy child process.

- Empty: inherit `HTTPS_PROXY` / `HTTP_PROXY` from process start (lowercase names, and an HTTP(S) `ALL_PROXY`, are also accepted). If none is set, connect directly. Every quota, login, and refresh request uses a dedicated HTTP client and sets the proxy on that request. It does not depend on Node’s global `fetch`, a global dispatcher, or `NODE_USE_ENV_PROXY`. After saving a port, `pnpm start` is enough; no environment-variable prefix is required. The startup log shows the proxy actually used and where it came from.
- The settings panel shows the proxy this process is using, separately from a saved value that is waiting for a restart.
- It detects environment variables and, on macOS, an enabled local HTTP(S) system proxy. A port mismatch is a warning, and the detected port can be filled in and saved. Other systems still detect environment variables. It does not scan unknown ports and does not change the saved setting by itself.
- The connection check only tests the local TCP port. It does not prove that the proxy protocol is correct or that the upstream provider is reachable. System-proxy detection does not support PAC or SOCKS-only proxies.
- `localhost`, `127.0.0.1`, and `::1` always bypass the proxy. Existing `NO_PROXY` rules are kept.

### Tests

```bash
pnpm test
```

The HTTPS proxy regression test uses the system `openssl` to create a temporary certificate and trusts only that certificate through `NODE_EXTRA_CA_CERTS`. It does not disable TLS verification. If `openssl` is missing, that case is skipped. The tests clear proxy environment variables and disable global `fetch` and the global dispatcher, then check that quota, login, and token refresh still go through the saved proxy port explicitly.

Regression tests also cover prompt CLI exit on startup failure, mixed environment/flag configuration, cross-origin API rejection, and the real Vite proxy. The packaging test runs `npm pack` from a temporary source snapshot with no `dist` and checks that the CLI and UI assets are included. The `prepack` hook runs `pnpm build`, so packing and publishing from source both clean and rebuild first.

### Layout

```text
Usage_Console/
├── bin/usage-console.js      # published command entry
├── package.json
├── vite.config.ts            # Vite build and dev proxy
├── src/client/               # React dashboard
└── src/server/               # local API, CLI, login, quota, and usage
    ├── cli.ts                # arguments and startup
    ├── listen.ts             # loopback bind unless remote bind is explicit
    ├── identity/             # console-owned OAuth login and token refresh
    ├── quota/                # Codex, Claude, Grok, and local agy quota
    └── usage/                # local session scan, pricing, and aggregation
```
