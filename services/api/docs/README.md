# 管理 API（`@olps/api`）

处理本系统账号与会话、草稿与所有权、业务数据、sandbox 同步，以及向独立远端服务 Push 网站版本。公开访客 HTTP 由 `@olps/remote` 提供，不由本服务单独承担。

## 日常开发

在仓库根目录：

```bash
docker compose up -d
copy .env.example .env
npm ci
npm run build
```

三个终端（顺序不限，须先配置 `.env` 中 `DATABASE_URL`、`REMOTE_SERVICE_URL`、`REMOTE_SERVICE_TOKEN`，且与 `@olps/remote` 一致）：

```bash
npm run dev -w @olps/remote
npm run dev -w @olps/api
npm run dev -w @olps/admin
```

默认端口：远端 `8790`（可用 `REMOTE_PORT` 覆盖）、管理 API `8787`（`PORT`）、Admin `5173`（Vite 代理 `/api` 到 API）。

健康检查：`GET http://127.0.0.1:8787/api/health` 返回 `{"ok":true}`。

生产式启动（编译后）：

```bash
npm run build -w @olps/api
npm run start -w @olps/api
```

## 环境变量（迁移相关）

| 变量 | 用途 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `SANDBOX_ROOT` | legacy 迁移与草稿 Git 工作目录 |
| `REMOTE_SERVICE_URL` / `REMOTE_SERVICE_TOKEN` | sandbox 构建校验与 Push（迁移阶段需要远端可达，可不发布） |
| `MIGRATION_SITE_OWNERS` | JSON 对象：legacy `site_id` → 本地 `account` 数组 |
| `MIGRATION_KB_OWNERS` | JSON 对象：legacy `kb_id` → 本地 `account` 数组（可无条目） |
| `MIGRATION_BOOTSTRAP_USERS` | bootstrap CLI：待创建账号 JSON 数组 `[{"account":"…","name":"…"}]` |
| `MIGRATION_BOOTSTRAP_CREDENTIALS_PATH` | bootstrap CLI：写入随机密码的凭据文件路径（勿提交仓库） |

协作模型与 legacy 字段说明见仓库根目录 [docs/site-collaboration.md](../../../docs/site-collaboration.md)。**生产库 `olps` 的完整迁移步骤**见 [docs/migration-rehearsal.md](../../../docs/migration-rehearsal.md)（当前文档描述流程；**不代表生产库已执行迁移**）。

## 迁移账号初始化 CLI

在 **`services/api` 目录**执行（依赖本 package 的 `tsx`）：

```bash
cd services/api
```

PowerShell 示例（路径与账号按环境替换；密码由 CLI 生成并写入凭据文件，不要在终端回显或提交）：

```powershell
$env:DATABASE_URL='postgres://olps:olps@127.0.0.1:5434/olps'
$env:MIGRATION_BOOTSTRAP_USERS='[{"account":"operator1","name":"Operator"}]'
$env:MIGRATION_BOOTSTRAP_CREDENTIALS_PATH='D:\secure\olps-migration-credentials.json'
npx tsx src/migration-bootstrap-users.ts
```

规则：凭据文件须不存在（`wx` 创建）；已存在的 `account` 跳过且不会覆盖已有密码；失败时仅删除**本进程**刚创建的凭据文件。

## 触发协作模型迁移

当数据库仍为 legacy 形态（`sites` 表含 `tenant_id` 列）时，**启动管理 API** 会在启动阶段调用 `migrateToCollaborationModel`（须已设置 `MIGRATION_SITE_OWNERS`，且映射中的每个 `account` 已在 `users` 表中存在）。

```powershell
$env:DATABASE_URL='postgres://olps:olps@127.0.0.1:5434/olps'
$env:SANDBOX_ROOT='.intermediate/sandboxes'
$env:REMOTE_SERVICE_URL='http://127.0.0.1:8790'
$env:REMOTE_SERVICE_TOKEN='与 .env 和 remote 进程一致'
$env:MIGRATION_SITE_OWNERS='{"legacy-site-uuid":["operator1"]}'
$env:MIGRATION_KB_OWNERS='{}'
npm run start -w @olps/api
```

迁移在单事务内锁定 legacy 十表、快照三条序列状态、构建或校验 sandbox、写入协作 schema 后恢复序列 `last_value`/`is_called`。legacy 已替换后再次启动仅执行常规 `migrate()`，保持幂等。

## 测试

```bash
npm run test -w @olps/api
npm run typecheck:test -w @olps/api
```

迁移与 bootstrap 行为见 `src/migration.*.test.ts`。
