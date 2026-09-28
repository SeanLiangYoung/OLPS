# 服务与运行方式

本机开发运行以下服务：

1. PostgreSQL：保存用户、登录会话、所有权、草稿索引和业务记录。
2. 管理 API（`services/api`）：处理账号、草稿编辑、权限、业务操作与网站同步。
3. 远端服务（`services/remote`）：接收网站 Git bundle，验证发布文件，保存版本并通过 HTTP 提供公开网站。
4. 管理界面（`apps/admin`）：提供账号登录、草稿编辑、所有者管理、Push/Pull 和冲突处理界面。

管理 API 与远端服务可以在同一台电脑运行，也可以分别部署。管理 API 从仓库根 `.env` 读取 `REMOTE_SERVICE_URL` 与 `REMOTE_SERVICE_TOKEN`；远端进程不加载该文件，须在其启动终端设置 `REMOTE_SERVICE_TOKEN`、`REMOTE_PUBLIC_BASE_URL`、`REMOTE_DATA_ROOT`（见根 [README.md](../README.md)）。浏览器访问网站的公开地址，无需管理账号。

`@olps/sync` 管理 sandbox 的 Git 工作目录、版本同步和 Cursor Agent 冲突处理。`@olps/site-builder` 根据页面源码生成并验证公开文件，构建程序随网站版本保存。

根目录 `npm run build` 顺序：`domain` → `site-builder` → `sync` → `remote` → `api` → `admin`。`npm run typecheck` 覆盖 `@olps/api` 全部 `*.test.ts` 与 `test-support`，以及 Admin 的 `vue-tsc`。集成测试数据库默认 `TEST_DATABASE_URL`（名称须含 `_test_`），与生产 `DATABASE_URL` 分离。

网站源码与构建结果保存在 Git 版本中。远端只在验证成功后切换公开网站的发布版本。每个发布版本使用独立目录，发布失败时保留当前访问内容。

管理界面和命令行调用管理 API 时使用登录取得的 Bearer accessToken。编辑接口包含 `draftId`，已发布网站业务接口包含 `siteId`。

新数据库由管理 API 建立所需结构（`npm run start -w @olps/api` 在无 legacy 表时执行常规 `migrate()`）。

**Legacy 库**（`sites.tenant_id` 仍存在）迁移到本地账号与草稿模型：

1. 备份数据库；准备 `MIGRATION_SITE_OWNERS` / `MIGRATION_KB_OWNERS` JSON（legacy `site_id`、`kb_id` → `account` 数组）。
2. 在 `services/api` 运行 `npx tsx src/migration-bootstrap-users.ts` 创建映射中的本地账号（见 `services/api/docs/README.md`）。
3. 配置 `DATABASE_URL`、`SANDBOX_ROOT`、`REMOTE_SERVICE_*` 与迁移映射后启动 `@olps/api`：启动过程调用 `migrateToCollaborationModel`（锁定十表、快照序列、构建 sandbox、写入协作表并恢复序列）。
4. 启动 `@olps/remote` 与 `@olps/admin`，用 bootstrap 凭据登录验收草稿与所有权。

三进程 PowerShell 启动与 token 一致要求见根目录 [README.md](../README.md)。完整迁移命令见 [migration-rehearsal.md](migration-rehearsal.md)。
