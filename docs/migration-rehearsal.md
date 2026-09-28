# 生产快照库迁移演练

仅针对备份恢复库 `olps_test_migration_snapshot`。禁止对 `olps` 原库执行迁移或写入。备份与站点 ID 见主仓库 `.intermediate/coordination/production-backup.md`；所有者映射见 `.intermediate/coordination/production-migration-owners.json`。

## 前置

- PostgreSQL：`postgres://olps:olps@127.0.0.1:5434/olps_test_migration_snapshot`
- 远端（sandbox 校验，不发布）：`REMOTE_SERVICE_URL=http://127.0.0.1:8790`，`REMOTE_SERVICE_TOKEN=olps-e2e-local-token`
- 演练 API 端口 `8788`（勿占用 8787/8790/5173/5174 上正在运行的 E2E）
- 主仓库目录 `.intermediate/migration-rehearsal/`：
  - `sandboxes/`：迁移 sandbox
  - `evidence/<runId>/legacy-snapshot.json`：迁移前 10 表与序列基线
  - `evidence/<runId>/post-migration-summary.json`：验证摘要
  - `credentials.json`：bootstrap 凭据（gitignore，脚本不输出密码）

## 编译

在 API worktree 根目录：

```bash
npm install
npm run build
npm run typecheck
```

## 脚本位置

主仓库：`.intermediate/validation/validate-snapshot-migration.ts`（gitignore，用编辑工具维护）。

在 `services/api` 下执行（使用本 package 的 `tsx` 与 `pg`）：

```powershell
cd services/api
npx tsx ../../../validation/validate-snapshot-migration.ts
```

PowerShell 可选环境变量示例：

```powershell
$env:OLPS_REPO_ROOT='D:\projects\open-landing-page-system'
$env:OLPS_API_PACKAGE='D:\projects\open-landing-page-system\.intermediate\worktrees\api\services\api'
```

| 变量 | 含义 |
|------|------|
| `OLPS_REPO_ROOT` | 主仓库根目录 |
| `OLPS_API_PACKAGE` | `@olps/api` 包路径 |
| `MIGRATION_REHEARSAL_ROOT` | 默认 `$OLPS_REPO_ROOT\.intermediate\migration-rehearsal` |
| `MIGRATION_OWNERS_JSON_PATH` | 默认 `$OLPS_REPO_ROOT\.intermediate\coordination\production-migration-owners.json` |
| `SNAPSHOT_DATABASE_URL` | 默认上述快照连接串 |
| `MIGRATION_VALIDATION_MODE` | 设为 `verify-existing` 时只验证已迁移库 |
| `MIGRATION_VERIFY_BASELINE_JSON` | 指定 `legacy-snapshot.json` 路径（否则在 `evidence/*/` 下按名称取最新） |
| `MIGRATION_VERIFY_EVIDENCE_DIR` | verify-existing 模式写入摘要的目录 |

## 全流程（legacy 库）

1. 锁定并读取 legacy 后捕获 10 表与三条序列，写入 `evidence/<runId>/legacy-snapshot.json`
2. `migration-bootstrap-users` 创建 `seanliang`、`test`，凭据写入 `credentials.json`
3. `migrateToCollaborationModel`（DROP 前快照序列，插入后 `setval` 恢复原 `last_value`/`is_called`）
4. 与基线严格比对；`sites` 无已发布行；Git 与 `site_drafts.head_commit_id` 一致
5. 二次迁移幂等
6. 启动本机 API（8788），等待 `/api/health` 返回 `{"ok":true}` 后登录校验草稿可见性
7. 写入 `post-migration-summary.json`

## verify-existing（已迁移库）

库中已有 `users`/`site_drafts`、不得 DROP 或重新 bootstrap 时使用：

```powershell
$env:MIGRATION_VALIDATION_MODE='verify-existing'
npx tsx ../../../validation/validate-snapshot-migration.ts
```

或：

```powershell
npx tsx ../../../validation/validate-snapshot-migration.ts --verify-existing
```

从已有 `legacy-snapshot.json` 读取基线（禁止把当前库当作 legacy 重捕）；复用 `credentials.json`；执行数据/Git/序列/归属/幂等/登录验证。缺少基线文件时脚本终止并报告证据路径。

## 协作模型（迁移结果）

- 每个 legacy `site_id` 对应确定性 `draft_id` 与 Git sandbox；认证 HEAD 为 `refs/olps/migration-certified-head`
- 未发布业务数据 `site_id` 为空，以 `draft_id` 归属；首次发布后 `sites` 才出现记录
- 演练不 push，不修改现有 E2E 站点
