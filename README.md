# Usage Console

<p align="center">
  <strong>本机运行的 AI 额度与 Token 用量看板 · 支持 Codex、Claude、Grok 和 Antigravity</strong><br>
  <em>A lightweight local dashboard for AI quota, token usage, and estimated spend.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen.svg" alt="Node.js 20+">
  <img src="https://img.shields.io/badge/pnpm-10.12.3-blue.svg" alt="pnpm">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License">
  <a href="https://www.npmjs.com/package/usage-console"><img src="https://img.shields.io/npm/v/usage-console.svg" alt="npm version"></a>
</p>

---

## 目录 / Table of Contents

- [🇨🇳 简体中文](#-简体中文)
  - [✨ 核心特性](#-核心特性)
  - [🚀 快速开始](#-快速开始)
  - [🖥️ macOS 原生菜单栏助手](#️-macos-原生菜单栏助手)
  - [📖 使用指南与配置](#-使用指南与配置)
    - [1. 额度账户绑定](#1-额度账户绑定)
    - [2. 本地用量扫描](#2-本地用量扫描)
    - [3. 网络代理配置](#3-网络代理配置)
  - [⌨️ CLI 命令与环境变量](#️-cli-命令与环境变量)
  - [🔒 安全、凭据与隐私声明](#-安全凭据与隐私声明)
  - [🛠️ 源码开发与测试](#️-源码开发与测试)
  - [📦 发布与维护](#-发布与维护)
- [🇺🇸 English](#-english)
  - [✨ Features](#-features)
  - [🚀 Quick Start](#-quick-start)
  - [🖥️ Native macOS Menu Bar](#️-native-macos-menu-bar)
  - [📖 Usage & Configuration](#-usage--configuration)
  - [⌨️ CLI & Environment Variables](#️-cli--environment-variables)
  - [🔒 Security & Privacy Notice](#-security--privacy-notice)
  - [🛠️ Development & Testing](#️-development--testing)
- [致谢与许可 / License](#-致谢与许可--license)

---

## 🇨🇳 简体中文

### ✨ 核心特性

- **多平台额度监控**：实时查看 Codex、Claude、Grok 和 Antigravity（AGY）的额度、速率限制窗口及重置倒计时。
- **iOS / macOS 毛玻璃美学**：采用现代化的高透光亚克力与高光边缘（Specular Rim）设计，内置深色/浅色自适应主题、弥散环境光晕、顶部统一刷新时钟胶囊与拟真波浪动态水感电池。
- **本地会话与 Token 深度分析**：自动扫描本机 CLI / 客户端的会话记录（支持今天 / 7天 / 30天 / 全部）。
  - 支持模型、渠道分布、缓存命中/写入比例。
  - 请求明细记录、首 Token 延迟（TTFT）与输出吞吐速率统计。
- **参考费用估算**：按内置模型定价实时换算估算 USD / CNY 消费（仅供参考）。
- **macOS 原生菜单栏助手**：纯 Swift 编写的 16pt 状态栏环形进度指示器，轻量独立常驻，一眼掌握各账户额度。
- **macOS 分类偏好设置**：清晰的侧边栏导航分类，轻松管理账户、刷新间隔、会话扫描目录及代理设置。

---

### 🚀 快速开始

#### 系统要求
- **Node.js 20+**（推荐 Node.js 22 或 24 LTS）。使用者无需安装 pnpm 或克隆源码。
- 网页看板支持 macOS、Linux 和 Windows。原生菜单栏仅在 macOS 提供。

#### 安装与启动

```bash
# 全局安装
npm install -g usage-console

# 启动服务（会自动在默认浏览器打开 http://127.0.0.1:3001）
usage-console
```

#### 常用启动参数

```bash
# 指定自定义端口
usage-console --port 4010

# 后台模式启动（不自动唤起浏览器）
usage-console --no-open

# 升级到最新版本
npm install -g usage-console@latest
```

> [!NOTE]
> - 在终端按下 **Ctrl+C** 即可终止服务。仅关闭浏览器网页**不会**停止后台服务进程。

---

### 🖥️ macOS 原生菜单栏助手

Usage Console 在 macOS 菜单栏用 16pt 圆环显示账户剩余额度。npm 发行包内置预编译助手，支持 Apple Silicon 和 macOS 13 及以上的 Intel Mac。

#### 前置要求
从源码运行或使用较早的 Intel macOS 时，需要安装 macOS Command Line Tools：
```bash
xcode-select --install
```

#### 启动菜单栏

一条命令即可启动菜单栏和本地服务。相同地址已有 Usage Console 服务时会复用它。需要查看统计或设置时，从菜单选择「打开完整看板」。

```bash
# 方式 1：通过 npm 全局命令启动（推荐）
usage-console menubar

# 方式 2：源码开发环境启动
node bin/usage-console.js menubar
```

#### 菜单栏特性与配置

- **圆环指示**：圆弧代表 5 小时 / 7 天窗口中较低的剩余比例；未知值呈现虚线，额度紧张时标记醒目圆点。
- **账户选择**：默认显示首个账户。点击「显示账户」菜单可自由勾选任意组合或「全部显示」，选项自动持久化。
- **快捷交互**：点击圆环可展开详情列表，展示各账户剩余百分比与重置倒计时；一键「打开完整看板」或「刷新显示」。
- **运行机制**：助手常驻并约每 60 秒直接读取本机菜单数据。「退出菜单栏」会关闭它启动的服务。单独启动的服务由原启动命令管理。

| 命令行选项 | 说明 |
| --- | --- |
| `--url <URL>` | 连接已运行的本机服务（仅允许回环地址）。自动启动默认端口为 `3001`，可用 `CONSOLE_PORT` 指定 |
| `--lang <zh\|en>` | 界面语言，默认 `zh` |
| `--account <ID>` | 初始显示单个指定账户 |
| `--accounts all` | 初始显示全部已配置账户 |
| `--accounts '["id1","id2"]'` | 初始指定显示的账户列表 JSON |
| `--data` | 仅输出结构化 JSON 数据流并退出（用于本机诊断） |

---

### 📖 使用指南与配置

#### 1. 额度账户绑定

在页面右上角点击「设置 → 账户」管理额度提供商：

- **Codex / Grok**：点击登录，在终端或弹出的官方页面输入设备码（Device Code）。
- **Claude**：点击授权，登录并同意后，将页面返回的授权 Code 粘贴回控制台。
- **Antigravity (AGY)**：需先在本机安装并登录 `agy` CLI。控制台直接通过系统子进程调用 `agy --print /usage`，无需额外存取凭据。

> [!TIP]
> 额度卡片刷新间隔默认为 2 分钟，可在「设置」中调整。如果接口临时失败，系统将保留旧读数至多 10 分钟并明确标出数据产生时间。

#### 2. 本地用量扫描

本地用量完全基于本地工作区会话文件统计，**无需登录对应提供商账户**。系统默认扫描以下路径：

| 工具 / 平台 | 默认扫描路径 |
| --- | --- |
| **Codex** | `~/.codex/sessions` |
| **Claude Code** | `~/.claude/projects`（亦检测 `CLAUDE_CONFIG_DIR` 与系统应用目录） |
| **Antigravity (AGY)** | `~/.gemini/antigravity/brain` 与 `~/.gemini/antigravity-cli/brain` |
| **Pi** | `~/.pi/agent/sessions` |
| **Grok** | `~/.grok/sessions` |

如您的工作路径不同，可在「设置 → 路径」中按需添加或修改自定义扫描目录。

#### 3. 网络代理配置

如果您的网络环境需要通过代理访问 AI 服务商接口，请在「设置 → 网络代理」中配置：

- **支持类型**：仅支持 **HTTP / 混合代理端口**（范围 1–65535），不支持纯 SOCKS 代理。
- **环境变量回退**：若留空，将自动沿用启动环境中的 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`。
- **生效机制**：修改并保存端口后，**必须重启后台服务进程**（仅刷新浏览器页面不会生效）。
- **回环直连**：本地回环地址（127.0.0.1 / localhost）始终自动绕过代理，并严格尊重已有 `NO_PROXY` 规则。

---

### ⌨️ CLI 命令与环境变量

#### 命令行参数

```text
用法:
  usage-console [--port <端口>] [--host <地址>] [--no-open] [--allow-remote]
  usage-console menubar [--url <地址>] [--lang <zh|en>]
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--port <1-65535>` | `3001` | 指定服务监听端口（忽略系统通用 `PORT` 变量） |
| `--host <IP>` | `127.0.0.1` | 指定服务绑定地址（忽略系统通用 `HOST` 变量） |
| `--allow-remote` | `false` | 允许绑定非回环地址（外部网络访问） |
| `--no-open` | `false` | 启动后不自动唤起默认浏览器 |
| `--help` / `-h` | - | 打印帮助信息并退出 |
| `--version` / `-v` | - | 打印版本信息并退出 |

#### 环境变量

| 环境变量 | 对应 CLI 参数 | 说明 |
| --- | --- | --- |
| `CONSOLE_PORT` | `--port` | 覆盖默认监听端口 |
| `CONSOLE_HOST` | `--host` | 覆盖默认绑定地址 |
| `CONSOLE_ALLOW_REMOTE` | `--allow-remote` | 设置为 `1` 时允许外部非回环绑定 |
| `CONSOLE_SETTINGS_PATH` | - | 指定自定义 `settings.json` 配置文件路径 |

---

### 🔒 安全、凭据与隐私声明

> [!CAUTION]
> **非官方客户端声明**：本开源项目为独立开发的第三方工具，不代表、不隶属于任何 AI 服务商。使用前请仔细了解各服务商的服务条款与授权规范。

1. **凭据存储**：
   - 配置文件与账户凭据分别保存在 `~/.usage-console/settings.json` 与 `credentials.json`。
   - `credentials.json` 中的 Refresh Token 为**明文存储**。在 POSIX 系统（macOS/Linux）上权限为 `0600`。请务必保护此目录权限，**严禁将凭据文件提交至版本控制或上传云端**。
2. **Claude 授权权限范围**：
   - Claude 登录沿用 Claude Code 的公开 Client ID，其范围包含 `user:inference`、`user:profile`、`user:sessions:claude_code`、`user:mcp_servers` 与 `user:file_upload`。
   - **保存的令牌具备推理及上传权限**，并非只读额度权限。仅在您信任并接受该范围的前提下进行授权。
3. **网络安全与无鉴权设计**：
   - 本地 API 默认**没有内置身份鉴权**，且默认只绑定本地回环地址（`127.0.0.1`）。
   - 前后端通信配有 Host / Origin 校验与 Fetch Metadata 校验，禁止跨站 CORS 请求。
   - **切勿在未加反向代理鉴权保护的情况下直接通过 `--allow-remote` 将服务暴露到公网。**

---

### 🛠️ 源码开发与测试

建议使用 **Node.js 24 LTS** 与项目锁定的 **pnpm 10.12.3**。

```bash
# 1. 安装指定版本 pnpm
npm install -g pnpm@10.12.3

# 2. 安装项目依赖
pnpm install --frozen-lockfile

# 3. 启动前后端热重载开发模式
# 前端 Vite 运行在 http://localhost:3000，代理后端 3001
pnpm dev

# 4. 代码类型检查
pnpm typecheck

# 5. 运行完整测试套件
pnpm test

# 6. 生产打包并运行
pnpm build
pnpm start
```

#### 打包完整性与冒烟验证

```bash
# 在临时沙箱目录打包并执行冒烟测试
RELEASE_DIR="$(mktemp -d)"
pnpm release:pack "$RELEASE_DIR"
node scripts/smoke-package.mjs "$RELEASE_DIR/package.tgz"
```

---

### 📦 发布与维护

- **CI 工作流**（`ci.yml`）：覆盖 Linux、macOS、Windows 与 Node 20 / 22 / 24，验证服务启动和复用，并在 macOS runner 上编译 Swift 菜单栏助手。
- **发布工作流**（`publish.yml`）：仅在推送 `v*` 版本标签时触发。采用 npm 官方 **Trusted Publishing (OIDC)** 自动化发布，无需手动维护长期发布令牌。
- 详细流程请查阅 [发布指南 (docs/RELEASING.md)](https://github.com/AmazingUmi/Usage_Console/blob/main/docs/RELEASING.md)。

---

## 🇺🇸 English

### ✨ Features

- **Multi-Provider Quota Dashboard**: Real-time quota limits, reset countdowns, and rate-limit windows for Codex, Claude, Grok, and Antigravity (AGY).
- **iOS / macOS Frosted Glass Aesthetic**: Modern high-transparency acrylic panels, specular rim highlights, ambient gradient blobs, unified top refresh clock capsule, and liquid wave battery meters with adaptive dark/light themes.
- **Local Session & Token Analytics**: Automatically parses local CLI and desktop session histories (Today / 7 Days / 30 Days / All Time).
  - Model & provider breakdown, prompt cache read/write statistics.
  - Request inspection, Time to First Token (TTFT), and token generation speed benchmarks.
- **Estimated Cost Tracking**: Real-time reference spend estimation in USD / CNY.
- **Native macOS Menu Bar Helper**: Standalone Swift-powered 16pt hollow menu bar rings for at-a-glance quota monitoring without bulky Electron bundles.
- **Categorized Preferences**: Clean sidebar navigation for accounts, custom session directories, refresh intervals, and local proxy setup.

---

### 🚀 Quick Start

#### Requirements
- **Node.js 20+** (Node.js 22 or 24 LTS recommended). End-users do not need pnpm or a git clone.
- The web dashboard runs on macOS, Linux, and Windows. The native menu bar is available on macOS.

#### Install & Launch

```bash
# Install globally via npm
npm install -g usage-console

# Launch the console (automatically opens http://127.0.0.1:3001)
usage-console
```

#### Useful CLI Options

```bash
# Bind to a custom port
usage-console --port 4010

# Launch in background / headless mode without auto-opening the browser
usage-console --no-open

# Update to latest version
npm install -g usage-console@latest
```

> [!NOTE]
> Press **Ctrl+C** in the terminal to terminate the service. Closing the browser tab does not stop the backend background process.

---

### 🖥️ Native macOS Menu Bar

Usage Console displays a native quota ring in the macOS menu bar. The npm release includes a precompiled helper for Apple Silicon and Intel Macs on macOS 13 or later.

#### Prerequisites
Install macOS Command Line Tools when running from a source checkout or on an Intel Mac with an earlier macOS release:
```bash
xcode-select --install
```

#### Start the Menu Bar

One command starts the menu bar and starts or reuses the local service. Choose **Open dashboard** from the menu for reports and settings. **Quit menu bar** also stops the service if the menu bar started it.

```bash
# Method 1: Via global npm package
usage-console menubar

# Method 2: In source checkout
node bin/usage-console.js menubar
```

#### Menu Bar Options

| Option | Description |
| --- | --- |
| `--url <URL>` | Attach to an existing loopback service. Automatic startup defaults to port `3001`, configurable with `CONSOLE_PORT` |
| `--lang <zh\|en>` | Language preference (default: `zh`) |
| `--account <ID>` | Display a single designated account by ID |
| `--accounts all` | Display all configured accounts |
| `--accounts '["id1","id2"]'` | Display specific account IDs |
| `--data` | Output diagnostic structured JSON and exit |

---

### 📖 Usage & Configuration

#### 1. Quota Account Setup
Navigate to **Settings → Accounts**:
- **Codex / Grok**: Official device-code authentication flow.
- **Claude**: Browser OAuth approval flow; paste the resulting authorization code.
- **Antigravity (AGY)**: Relies on local authenticated `agy` CLI (`agy --print /usage`). No separate credentials stored.

#### 2. Local Usage Scanning
Local token analysis parses local files directly and **does not require provider account logins**:
- **Codex**: `~/.codex/sessions`
- **Claude Code**: `~/.claude/projects` (and `CLAUDE_CONFIG_DIR`)
- **Antigravity**: `~/.gemini/antigravity/brain` & `~/.gemini/antigravity-cli/brain`
- **Pi**: `~/.pi/agent/sessions`
- **Grok**: `~/.grok/sessions`

#### 3. Network Proxy
Configure under **Settings → Network proxy**:
- Accepts **HTTP / mixed-protocol proxy ports** (1–65535). SOCKS-only proxies are not supported.
- Falls back to `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` if left empty.
- **Important**: Changes require a server process restart to take effect.
- Loopback addresses always bypass proxies and respect existing `NO_PROXY` settings.

---

### ⌨️ CLI & Environment Variables

| CLI Flag | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `--port <1-65535>` | `CONSOLE_PORT` | `3001` | Server listening port |
| `--host <IP>` | `CONSOLE_HOST` | `127.0.0.1` | Server listening interface |
| `--allow-remote` | `CONSOLE_ALLOW_REMOTE` | `false` | Permit binding to non-loopback interfaces |
| `--no-open` | - | `false` | Disable auto-opening the browser |
| - | `CONSOLE_SETTINGS_PATH` | - | Custom path to `settings.json` |

---

### 🔒 Security & Privacy Notice

> [!CAUTION]
> **Disclaimer**: This is an independent open-source project and is not affiliated with OpenAI, Anthropic, xAI, or Google.

- **Tokens & Credentials**: Refresh tokens are stored unencrypted in `~/.usage-console/credentials.json` (POSIX permissions `0600`). Never share or upload this file.
- **Claude Scope Warning**: Claude authorization uses Claude Code's public client ID with broad scopes including `user:inference` and `user:file_upload`. Authorize only if you accept these capabilities.
- **No Inherent API Authentication**: The backend is intended for loopback usage. Do not expose the port publicly via `--allow-remote` without an authenticating reverse proxy.

---

### 🛠️ Development & Testing

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Start development servers (Vite on :3000, API on :3001)
pnpm dev

# Check types across client, server, and test suites
pnpm typecheck

# Run tests
pnpm test

# Build for production
pnpm build
pnpm start
```

---

## 🤝 致谢与许可 / License

- Inspired by [codex-switch](https://github.com/AmazingUmi/codex-switch) and [pi-quota-monitor](https://github.com/AmazingUmi/pi-quota-monitor).
- Licensed under the [MIT License](LICENSE) © AmazingUmi.
