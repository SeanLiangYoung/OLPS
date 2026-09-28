# Legacy 库迁移与快照演练

从含 `sites.tenant_id` 的 PostgreSQL 库迁移到本地账号、草稿所有权与独立远端协作模型。身份为 `users.account` 密码登录。

**已是协作库**（`sites` 无 `tenant_id`）时，日常只需根目录 `.env` 与 [README.md](../README.md) 三进程启动；勿再设置 `MIGRATION_*`，API 启动时仅执行常规 `migrate()`。

## 运行拓扑

与日常开发相同：远端、管理 API、Admin 三进程。根目录 [README.md](../README.md) 给出 PowerShell 三终端命令（远端须显式设置 `REMOTE_PUBLIC_BASE_URL`、`REMOTE_DATA_ROOT` 与 `REMOTE_SERVICE_TOKEN`；API 从根 `.env` 读取 `REMOTE_SERVICE_URL` / `REMOTE_SERVICE_TOKEN`，token 须一致）。

迁移前远端须已监听；API 启动时若仍为 legacy 库则执行 `migrateToCollaborationModel`。

迁移 sandbox 构建在 API 进程内本地执行 `runValidation` 与 `verifySite`（见 `migration-sandbox.ts`）。须配置 `REMOTE_SERVICE_URL` 与 `REMOTE_SERVICE_TOKEN` 以满足 `SyncWorkspace` 构造；**不会**在迁移事务中向远端创建站点或 Push bundle。

## 预检与备份

1. 确认 legacy：`sites` 表存在 `tenant_id`。
2. 对目标库做逻辑备份；演练使用单独数据库名（例如 `olps_test_migration_snapshot`）。
3. 准备 `MIGRATION_SITE_OWNERS`、`MIGRATION_KB_OWNERS`（环境变量 JSON，勿提交仓库）。
4. 保存 legacy 十表与三条序列（`inquiries_inquiry_id_seq`、`inquiry_email_outbox_outbox_id_seq`、`analytics_events_event_id_seq`）的 `last_value`/`is_called` 基线（例如 `legacy-snapshot.json`）。迁移程序在 DROP 前快照并在插入后 `setval` 恢复。
5. **只读 preflight**（legacy 库、不写库）：本机 `.intermediate/validation/validate-snapshot-migration.ts`，设置 `SNAPSHOT_DATABASE_URL`（默认快照库）、`MIGRATION_VERIFY_BASELINE_JSON` 或 `--baseline <path>`，执行 `--preflight`。当前库与基线不一致则报告差异并失败，不修改基线文件。

## 迁移账号初始化

在 `services/api` 目录：

```powershell
$Root = '…'
Set-Location (Join-Path $Root 'services\api')
$env:DATABASE_URL = 'postgres://olps:olps@127.0.0.1:5434/olps'
$env:MIGRATION_BOOTSTRAP_USERS = '[{"account":"seanliang","name":"Sean"},{"account":"test","name":"Test"}]'
$env:MIGRATION_BOOTSTRAP_CREDENTIALS_PATH = Join-Path $Root '.intermediate\migration-rehearsal\credentials.json'
npx tsx src/migration-bootstrap-users.ts
```

凭据路径已存在时 bootstrap 拒绝运行；勿在终端打印密码或提交凭据文件。

## 执行协作模型迁移

映射中每个 `account` 须已在 `users` 表。仓库根目录（远端已按 README 启动）：

```powershell
$Root = '…'
$Token = 'olps-remote-dev-token'
$env:DATABASE_URL = 'postgres://olps:olps@127.0.0.1:5434/olps'
$env:SANDBOX_ROOT = Join-Path $Root '.intermediate\sandboxes'
$env:REMOTE_SERVICE_URL = 'http://127.0.0.1:8790'
$env:REMOTE_SERVICE_TOKEN = $Token
$env:MIGRATION_SITE_OWNERS = '{"69f9cd6c-a6ce-4536-9e19-00b95dc05eb2":["seanliang"],"8d0e28fd-706b-4da7-854f-176fdfe8c44f":["seanliang","test"]}'
$env:MIGRATION_KB_OWNERS = '{"12c24426-37f2-4914-bab6-50a14b57e7bd":["seanliang"]}'
Set-Location $Root
npm run start -w @olps/api
```

要点见 [site-collaboration.md](site-collaboration.md) Legacy 迁移一节：确定性 `draft_id`、Git sandbox、`refs/olps/migration-certified-head`；迁移后未发布业务行以 `draft_id` 归属；序列与迁移前一致。

## 迁移后验收

1. `GET /api/health` 正常。
2. Admin 登录 bootstrap 账号：`http://127.0.0.1:5173/login`。
3. 草稿数量与 `MIGRATION_SITE_OWNERS` 一致；共享站点仅对映射账号可见。
4. **数据比对**：legacy 十表行（字段、JSON、时间戳）、三条序列 `last_value`/`is_called` 与迁移前基线一致；迁移后业务表行与 legacy 快照逐项对应（`site_id` 为空、`draft_id` 映射正确）。sandbox Git `HEAD` 与 `site_drafts.head_commit_id`、认证 ref 一致。
5. `npm run test -w @olps/api` 中迁移相关用例。

## 快照库演练

`DATABASE_URL` 指向备份库；`SANDBOX_ROOT` 使用单独目录（例如 `Join-Path $Root '.intermediate\migration-rehearsal\sandboxes'`）。证据 JSON 可保存在本机 `.intermediate\migration-rehearsal\evidence\<runId>\`（不进 Git）。已迁移且已有凭据的快照库勿重复 bootstrap；验收用 `--verify-existing` 或 preflight + 上节数据比对。

端口冲突时可设 `$env:PORT='8788'`、`$env:PUBLIC_API_BASE_URL='http://127.0.0.1:8788'`。

## 相关文档

- [site-collaboration.md](site-collaboration.md)
- [services.md](services.md)
- [services/api/docs/README.md](../services/api/docs/README.md)
