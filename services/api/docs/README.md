# 管理 API（`@olps/api`）

处理本系统账号与会话、草稿与所有权、业务数据、sandbox 同步，以及向独立远端服务 Push 网站版本。公开访客 HTTP 由 `@olps/remote` 提供，不由本服务单独承担。

草稿完整页面预览（capability token、静态资源路径）见 [preview-access.md](preview-access.md)。

## 日常开发

在仓库根目录：

```powershell
docker compose up -d
copy .env.example .env
npm ci
npm run build
```

`src/config.ts` 从**仓库根**加载 `.env`。远端进程不读该文件，三进程启动方式见根目录 [README.md](../../../README.md)（PowerShell 三终端示例）。

默认端口：远端 `8790`（`REMOTE_PORT`）、管理 API `8787`（`PORT`）、Admin `5173`（Vite 将 `/api` 代理到 `8787`）。

健康检查：`GET http://127.0.0.1:8787/api/health` 返回 `{"ok":true}`。

编译后启动 API：

```powershell
Set-Location $Root
npm run start -w @olps/api
```

协作库（无 `sites.tenant_id`）仅需上述 `.env` 与三进程；Pull/Push 冲突合并使用本机 Cursor Agent（`CURSOR_AGENT_COMMAND`，见 `@olps/sync`）。

## 环境变量（迁移相关）

| 变量 | 用途 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `SANDBOX_ROOT` | legacy 迁移与草稿 Git 工作目录（相对路径相对仓库根解析） |
| `REMOTE_SERVICE_URL` / `REMOTE_SERVICE_TOKEN` | 与远端 token 一致；Push 与 `SyncWorkspace` 必填 |
| `MIGRATION_SITE_OWNERS` | JSON：legacy `site_id` → 本地 `account` 数组 |
| `MIGRATION_KB_OWNERS` | JSON：legacy `kb_id` → 本地 `account` 数组 |
| `MIGRATION_BOOTSTRAP_USERS` | bootstrap CLI：账号 JSON 数组 |
| `MIGRATION_BOOTSTRAP_CREDENTIALS_PATH` | bootstrap CLI：凭据 JSON 输出路径（勿提交仓库） |
| `PREVIEW_CREDENTIAL_TTL_SECONDS` | 草稿预览 capability 有效期（默认 900） |

协作模型与 legacy 迁移行为见 [docs/site-collaboration.md](../../../docs/site-collaboration.md)、步骤见 [docs/migration-rehearsal.md](../../../docs/migration-rehearsal.md)。

**迁移 sandbox 构建**（`migration-sandbox.ts`）：在本地执行 `runValidation`（站点 build）与 `verifySite`；须配置 `REMOTE_SERVICE_URL` 与 `REMOTE_SERVICE_TOKEN`，迁移过程中**不会**调用远端创建站点或 Push。

## Push 失败与重试

远端连接失败时 Push 写入草稿 `error` 状态并保留 `lastError`（`push-remote-transport-error.ts`），sandbox 内容不变。远端与 token 配置正确后再次 `POST .../push` 即可。版本冲突与校验失败由 sandbox `syncStatus` 与 Admin 冲突流程处理，见 [docs/error-handling.md](../../../docs/error-handling.md)。

## 迁移账号初始化 CLI

在 **`services/api` 目录**执行（仅 legacy 库排期前）：

```powershell
$Root = '…'  # 仓库根绝对路径
Set-Location (Join-Path $Root 'services\api')
$env:DATABASE_URL = 'postgres://olps:olps@127.0.0.1:5434/olps'
$env:MIGRATION_BOOTSTRAP_USERS = '[{"account":"operator1","name":"Operator"}]'
$env:MIGRATION_BOOTSTRAP_CREDENTIALS_PATH = 'D:\secure\olps-migration-credentials.json'
npx tsx src/migration-bootstrap-users.ts
```

凭据文件须不存在（`wx`）；已存在则 CLI 立即失败。已存在的 `account` 跳过且不会写入新密码。

## 触发协作模型迁移

数据库含 `sites.tenant_id` 时，**启动管理 API** 会调用 `migrateToCollaborationModel`（须已设置 `MIGRATION_SITE_OWNERS`，映射中每个 `account` 已在 `users` 表）。

先按根目录 README 启动远端，再启动 API（示例在仓库根）：

```powershell
$Root = '…'
$Token = 'olps-remote-dev-token'
$env:DATABASE_URL = 'postgres://olps:olps@127.0.0.1:5434/olps'
$env:SANDBOX_ROOT = Join-Path $Root '.intermediate\sandboxes'
$env:REMOTE_SERVICE_URL = 'http://127.0.0.1:8790'
$env:MIGRATION_SITE_OWNERS = '{"legacy-site-uuid":["operator1"]}'
$env:MIGRATION_KB_OWNERS = '{}'
$env:REMOTE_SERVICE_TOKEN = $Token
Set-Location $Root
npm run start -w @olps/api
```

迁移在单事务内锁定 legacy 十表、快照三条序列、构建或校验 sandbox、写入协作 schema 后恢复序列。协作 schema 下再次启动仅执行常规 `migrate()`。

## 测试

```bash
npm run test -w @olps/api
npm run typecheck:test -w @olps/api
```

迁移与 bootstrap 行为见 `src/migration.*.test.ts`；完整套件是否全部通过以 CI 与本地 `npm run test -w @olps/api` 实际结果为准。
