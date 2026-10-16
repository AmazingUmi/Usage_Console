# npm 发布指南

本文面向维护者。增加这些文件、提交或推送普通分支都**不会**发布 npm 包；只有推送 `v*` 标签才会进入 `publish.yml`。真正上传还依赖 npm 授权及 GitHub environment 配置。

## 1. 流程与权限边界

```text
PR / main → CI：Linux、macOS、Windows × Node 20、22、24
v* 标签   → 同一套 CI → 检查版本/仓库 → 构建 tgz → 隔离安装运行 → 保存 artifact
          → npm environment → 校验 artifact SHA-512 → OIDC 发布 → 比对 registry integrity
```

- `ci.yml` 可独立运行，也被发布 workflow 复用；类型检查、测试或生产依赖审计（moderate 及以上）失败都会阻止发布。
- 构建和验收 job **没有** `id-token: write`。只有最终 `publish` job 有该权限；它不安装项目依赖、不重建、不运行包生命周期脚本。
- Actions 固定到完整 commit SHA；pnpm 版本由 `package.json#packageManager` 固定。升级 Actions 时应同步核对官方 release 和 action inputs。
- 同一 workflow run 按 artifact ID 下载已验收的 `package.tgz`，并再次比对 SHA-512；不从另一轮 workflow 或任意 URL 取包。
- 正式版本 → `latest`；含预发布标识的版本 → `next`。支持如 `0.2.0-beta.1`、`0.2.0-rc.0`，不接受前导零或 `+build` 元数据。
- 发布串行执行，不中断正在运行的发布。**一次只推一个版本标签，等待该轮结束后再发下一版**，不要批量推送历史标签或倒序发布版本。
- workflow 不创建 GitHub Release。需要时可在 npm 验证完成后，基于同一个 tag 单独创建 Release。

Node 20 是兼容性检查；维护和发布推荐 Node 24。发布 job 使用 Node 24，npm CLI 必须满足 OIDC 所需的 **11.5.1+**（Node **22.14+**）。不需要配置 `NPM_TOKEN` / `NODE_AUTH_TOKEN`。

## 2. 发布前检查

先将拟发布代码合入 `main`，确保工作区干净、GitHub CI 通过。CI 的矩阵配置不等于已经在所有平台验证成功；以实际 Actions 结果为准。

```bash
git switch main
git pull --ff-only
git status --short                 # 应无输出
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm audit --prod --audit-level=moderate
pnpm release:check                 # 只检查元数据，不发布
```

还需人工确认：

- README 安装说明、版本、仓库 URL、MIT 许可和更新说明正确。
- 真实服务商登录、额度、续期和 agy 使用符合预期；CI 用本地模拟接口，不会替你验收真实账号或各 OS 的浏览器自动打开。
- 非官方客户端及 Claude 非只读授权的告知完整，相关服务商政策允许相应用途。
- tarball 不含真实凭据、会话记录、`.npmrc`、本机配置或临时文件。
- 首次发布前确认 npm 名称和账号权限；`npm view usage-console` 返回 E404 不等于名称已为你保留。

脚本 `pnpm release:pack <目录>` 会调用 npm 的 `prepack`，清理并构建，然后检查文件白名单，输出固定名 `package.tgz` 和 SHA-512。它不登录、不发布。`scripts/smoke-package.mjs` 会在临时目录仅安装生产依赖，以隔离 HOME 启动服务，检查 CLI / health / HTML / JS / CSS，最后关闭进程并清理。

## 3. 首次发布：手动建立 npm 包

新包尚无 npm package settings 时，先由维护者使用本人的 npm 账号和 2FA 完成一次手动发布。不要把密码、验证码或 token 放入 GitHub workflow、仓库或聊天记录。

以下为 macOS / Linux shell 示例，在同一个终端执行；当前首版为 `0.1.0`：

```bash
pnpm release:check v0.1.0
RELEASE_DIR="$(mktemp -d)"
pnpm release:pack "$RELEASE_DIR"
node scripts/smoke-package.mjs "$RELEASE_DIR/package.tgz"

npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish "$RELEASE_DIR/package.tgz" --dry-run --access public --registry=https://registry.npmjs.org/

# 确认账号、版本、内容和权限后，才执行真正上传：
npm publish "$RELEASE_DIR/package.tgz" --access public --tag latest --registry=https://registry.npmjs.org/
npm view usage-console@0.1.0 version dist.integrity --registry=https://registry.npmjs.org/
```

`--dry-run` 不上传，也不能证明最终具备发布权限。首发同样要发布**刚刚验收的 tgz**，不要换成重新构建的另一个包。若首版是预发布版本，手动发布时应使用 `--tag next`，而不是 `latest`。

记录同一份提交的标签（不要重复创建已有标签）：

```bash
git tag -a v0.1.0 -m "usage-console v0.1.0"
git push origin main
git push origin v0.1.0
```

标签会触发 workflow。若 registry 已有**完全相同字节**的包，脚本只验证并跳过上传，不改变 dist-tag；若字节不同则失败，不会覆盖。即使同一份源码，不同 Node / zlib 也可能生成不同压缩字节；首版标签因此失败不代表手动首发失败，不要移动标签，后续用新版本验证自动发布。可在配置好下一节后再推首版标签，但这次“跳过”不算一次成功的 OIDC 发布。

**同一个 name@version 发布后不能覆盖重发，即使 unpublish 也不能复用。** 不要为了修复发布流程而移动已经公开版本的标签；修复代码或包内容后发新版本。

## 4. 一次性配置 OIDC

### GitHub

在 `AmazingUmi/Usage_Console` → Settings → Environments 新建 **`npm`**：

- 名称必须与 `publish.yml` 的 `environment: npm` 一致。
- 建议只允许 `v*` **标签**部署，并通过 Rulesets 限制标签创建、更新和删除。
- 可增加 required reviewers；启用后，自动检查与打包仍会运行，上传 job 等待维护者批准。
- 不添加 npm 发布 token secret。首次跑到 environment 时也不要把自动创建的无保护环境误认为已经配置好审批。

### npm

打开 `usage-console` → Settings → Trusted publishing，添加 **GitHub Actions**：

| 字段 | 值 |
| --- | --- |
| Organization or user | `AmazingUmi` |
| Repository | `Usage_Console` |
| Workflow filename | `publish.yml`，不是完整路径 |
| Environment name | `npm` |
| Allowed actions | **允许 `npm publish`** |

当前 npm 新配置默认只允许 staging；本 workflow 直接发布，必须另勾选 `npm publish`。不需要 `npm dist-tag` 管理权限。以上字段区分大小写，仓库迁移或 workflow 改名时应同步重新配置。

- 使用 GitHub-hosted runners；本方案不依赖自托管 runner。
- `package.json#repository.url` 必须匹配发布仓库。本项目使用 `git+https://github.com/AmazingUmi/Usage_Console.git`；fork 若要自行发布，应修改包名、仓库 URL，并配置自己的 npm 权限。
- 新建 trusted publisher 后，要在 **2 天内完成首次真正的 OIDC 发布**。超时需删除过期配置并重新建立；重跑一个已存在版本的“跳过”不能验证授权。
- OIDC 成功后，可在 npm Publishing access 选择要求 2FA 并禁止传统 token；这不会禁用 trusted publishing。
- 公开 GitHub 仓库 + 公开 npm 包通过 OIDC 发布时，npm 自动生成 provenance。首次本机手动发布不会因此自动附带 provenance。

官方：[Trusted publishing](https://docs.npmjs.com/trusted-publishers) · [2FA](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification) · [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish)

## 5. 后续自动发布

以下命令会生成真实发布标签，**不要只为测试 workflow 而推送**。先确认 npm / GitHub 配置已完成，再从干净的 main 开始：

```bash
# 正式补丁版，例如 0.1.0 → 0.1.1；npm version 自动提交并创建 v0.1.1 标签
npm version patch -m "chore: release %s"

# 在推送前检查新版本
pnpm release:check
pnpm typecheck
pnpm test

git push origin main
git push origin v0.1.1
```

推送时把示例标签替换为 `package.json` 中的实际版本。小功能可用 `npm version minor`，不兼容变更按 SemVer 选择版本。

预发布示例：

```bash
# 例如 0.1.1 → 0.2.0-beta.0，自动创建对应 v 标签
npm version preminor --preid=beta -m "chore: release %s"
# 检查后推 main 与实际生成的 v0.2.0-beta.0 标签
```

workflow 会把预发布版放到 `next`，用户通过 `npm install -g usage-console@next` 试用。转正式版时使用新的正式版本（如 `0.2.0`），不要把 beta 的同一个版本当成稳定版覆盖发布。

Actions 成功后，在项目目录外核验：

```bash
npm view usage-console@0.1.1 version dist.integrity --registry=https://registry.npmjs.org/
npm install -g usage-console@0.1.1
usage-console --version
```

## 6. 失败与重试

若只是 npm 授权或临时网络问题，修复外部配置后优先 **Re-run failed jobs**，复用打包 job 已保存的同一个 artifact，不要重新打包替换。产物保留 7 天；完整重跑会生成新的 attempt artifact，即使同一源码也不保证压缩字节完全相同。发布阶段始终严格比对 tgz 字节，而不是只比较解压后的文件。

| 情况 | 处理 |
| --- | --- |
| 标签不匹配版本 / 非规范版本 | 上传前失败。检查正确的版本提交；不要移动已发布标签 |
| CI / 审计 / 打包 / 独立安装失败 | 未上传。修复并重走检查；未公开版本是否重建标签也须遵守仓库 Rulesets |
| OIDC / ENEEDAUTH / E403 | 核对 owner、repo、`publish.yml`、`npm`、Allowed actions、配置是否过期及 `id-token: write`；不要临时加长期 token 绕过 |
| registry 查询遇到网络或鉴权错误 | 失败关闭，不把查询失败当成“版本不存在” |
| 下载产物与打包时 SHA-512 不符 | 上传前失败；不要绕过校验或改用未验收的 tarball |
| 相同版本、相同字节已存在 | 验证后跳过上传，不改 dist-tag；适用于首版手动发布后的标签或相同产物重试 |
| 相同版本、不同字节已存在 | 拒绝发布。查明差异并升版本，不能覆盖 |
| npm 上传返回成功但后验超时 | 先 `npm view <name>@<version> dist.integrity`；不要假定失败后立即重新发不同产物 |

更改 workflow、重新跑 job 或安装包都不能替代 npm 侧权限配置。`npm whoami` 也不能验证 OIDC 权限；只有一次真正的新版本 OIDC 发布才能验证完整链路。

## English quick reference

1. Bootstrap the first package manually with your own npm account and 2FA. Test and publish the same `package.tgz`.
2. Create the GitHub environment **`npm`**. Configure the npm trusted publisher for **AmazingUmi / Usage_Console / publish.yml / npm**, explicitly allowing **`npm publish`**. No long-lived npm token is used.
3. A new trusted publisher must make its first actual OIDC publish within two days. A skipped, already-published version does not validate it.
4. Update the package version, commit, then push its exact **`v<version>`** tag. Stable versions use `latest`; prereleases use `next`. Push one version at a time.
5. The workflow reuses the OS/Node CI matrix, packs once, installs and checks the actual tarball with an isolated HOME, uploads an immutable artifact, then verifies its SHA-512 before the OIDC job publishes it without rebuilding.
6. Identical published bytes are a no-op; different bytes under the same version fail. Even identical source can produce different gzip bytes across Node/zlib versions. Prefer **Re-run failed jobs** to reuse the tested artifact (retained for seven days). Published versions and release tags must not be overwritten. Verify npm state before retrying a partially successful run.

The workflow creates npm releases, not GitHub Releases. GitHub-hosted execution and real npm OIDC publication still require external setup and cannot be fully verified by local tests alone.
