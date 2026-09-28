# Legacy 库迁移与快照演练

本文描述从带 `tenant_id` 的 legacy PostgreSQL 库迁移到**本地账号 + 网站/草稿所有权 + 独立远端**协作模型的可执行步骤。身份为本系统 `users.account` / 密码登录，**无**外部 SSO 或 ai-site 对接。

**生产库 `olps` 尚未按本文执行迁移**；下列命令供主控排期时使用。演练仅使用备份恢复库（例如 `olps_test_migration_snapshot`），禁止对生产库误操作。

## 一、运行拓扑

迁移与日常开发均依赖三个进程（可先 `npm run build`）：

| 进程 | 命令 | 默认端口 |
|------|------|----------|
| 独立远端 `@olps/remote` | `npm run dev -w @olps/remote` 或 `npm run start -w @olps/remote` | `8790` |
| 管理 API `@olps/api` | `npm run dev -w @olps/api` 或 `npm run start -w @olps/api` | `8787` |
| 管理后台 `@olps/admin` | `npm run dev -w @olps/admin` | `5173` |

`.env` 中 `REMOTE_SERVICE_URL`、`REMOTE_SERVICE_TOKEN` 必须与远端进程一致。迁移构建 sandbox 时会调用远端校验，**不要求**对访客发布新站点。

## 二、预检与备份

1. 确认 legacy 库：`sites` 表存在 `tenant_id` 列（协作库无此列）。
2. 使用 PostgreSQL 16 工具对目标库做逻辑备份，例如容器内 `pg_dump`，恢复验证在**单独数据库名**上进行。
3. 准备所有权映射（JSON，通过环境变量注入，勿写入仓库）：
   - `MIGRATION_SITE_OWNERS`：每个 legacy `site_id` → 本地账号名数组（多所有者共享草稿）。
   - `MIGRATION_KB_OWNERS`：每个 legacy `kb_id` → 本地账号名数组；无知识库可为 `{}`。
4. 记录 legacy 十表与三条序列（`inquiries_inquiry_id_seq`、`inquiry_email_outbox_outbox_id_seq`、`analytics_events_event_id_seq`）的 `last_value`/`is_called`，供迁移后核对（迁移程序会在 DROP 前快照并在插入后 `setval` 恢复）。

## 三、迁移账号初始化

在仓库根目录安装依赖后，于 **`services/api`** 运行官方 CLI（见 [services/api/docs/README.md](../services/api/docs/README.md)）：

```powershell
cd services\api
$env:DATABASE_URL='postgres://olps:olps@127.0.0.1:5434/olps'
$env:MIGRATION_BOOTSTRAP_USERS='[{"account":"seanliang","name":"Sean"},{"account":"test","name":"Test"}]'
$env:MIGRATION_BOOTSTRAP_CREDENTIALS_PATH='D:\secure\olps-migration-credentials.json'
npx tsx src/migration-bootstrap-users.ts
```

凭据文件仅保存在运维指定路径，权限受限，**不得**提交 Git 或在日志中打印密码。

## 四、执行协作模型迁移

映射中的每个账号必须已存在于 `users` 表。设置环境变量后**启动管理 API**（迁移在启动时自动执行一次）：

```powershell
cd 仓库根目录
$env:DATABASE_URL='postgres://olps:olps@127.0.0.1:5434/olps'
$env:SANDBOX_ROOT='.intermediate/sandboxes'
$env:REMOTE_SERVICE_URL='http://127.0.0.1:8790'
$env:REMOTE_SERVICE_TOKEN='与 .env 中一致'
$env:MIGRATION_SITE_OWNERS='{"69f9cd6c-a6ce-4536-9e19-00b95dc05eb2":["seanliang"],"8d0e28fd-706b-4da7-854f-176fdfe8c44f":["seanliang","test"]}'
$env:MIGRATION_KB_OWNERS='{"12c24426-37f2-4914-bab6-50a14b57e7bd":["seanliang"]}'
npm run start -w @olps/api
```

结果要点（详见 [site-collaboration.md](site-collaboration.md) Legacy 迁移一节）：

- 每个 legacy `site_id` → 确定性 `draft_id` 与 Git sandbox；认证 commit 存于 `refs/olps/migration-certified-head`。
- 迁移后 `sites` 无伪造发布行；历史业务行 `site_id` 为空、以 `draft_id` 归属。
- 序列状态与迁移前一致；再次启动 API 时迁移逻辑幂等。

## 五、迁移后验收

1. `GET /api/health` 正常。
2. Admin 登录 bootstrap 账号：`http://127.0.0.1:5173/login`。
3. 工作区草稿数量与 `MIGRATION_SITE_OWNERS` 一致；共享站点仅出现在映射中的账号下。
4. 可选：对照备份中的 legacy 行 ID、JSON 字段、时间与序列；对照 sandbox Git HEAD 与 `site_drafts.head_commit_id`。
5. 运行仓库测试：`npm run test -w @olps/api` 中迁移相关用例（不替代生产数据验收）。

## 六、快照库演练（可选）

使用自备份恢复的**独立**数据库（例如 `olps_test_migration_snapshot`），**禁止**写入或 DROP 生产库 `olps`。流程与第四节相同，仅 `DATABASE_URL` 指向快照库；`SANDBOX_ROOT` 建议使用单独目录（例如本机 `.intermediate/migration-rehearsal/sandboxes`，已在 `.gitignore`）。

主控在本机快照库上完成严格字段/序列/Git/双账号登录验证后，可将证据保存在本机（不进 Git），例如：

- legacy 基线：`…\.intermediate\migration-rehearsal\evidence\<runId>\legacy-snapshot.json`
- 验收摘要：`…\.intermediate\migration-rehearsal\evidence\verify-existing-<runId>\post-migration-summary.json`
- sandbox：`…\.intermediate\migration-rehearsal\sandboxes\`
- 凭据：`…\.intermediate\migration-rehearsal\credentials.json`

路径因机器而异；记录实际 `runId` 与文件位置供审计即可。已迁移的快照库**不要**再次 bootstrap 覆盖凭据；验收时复用已有凭据与已保存的 `legacy-snapshot.json` 基线，对照当前库与登录行为。

演练专用 API 端口若与默认 `8787` 冲突，可设 `$env:PORT='8788'` 与 `$env:PUBLIC_API_BASE_URL='http://127.0.0.1:8788'`，且勿占用正在运行的 E2E 端口。

## 七、相关文档

- 协作模型与 Admin API：[site-collaboration.md](site-collaboration.md)
- 服务分工：[services.md](services.md)
- API 包说明：[services/api/docs/README.md](../services/api/docs/README.md)
