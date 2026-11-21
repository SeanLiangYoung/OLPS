# 数据库与网站内容迁移演练

## 演练准备

从生产数据库和网站目录取得完整备份，在名称包含 `_test_` 的独立 PostgreSQL 数据库及独立网站目录中恢复副本。正式迁移前记录业务表数量、原始字段和三条编号序列的 `last_value`、`is_called`。数据库与网站目录需要属于同一份备份；加密凭据还需要对应的 `CREDENTIALS_ENCRYPTION_KEY`。

演练保留 `users`、`sites`、`site_drafts`、`inquiries`、`reports`、`jobs` 的数量基线，并比对旧十张业务表的主键、日期、JSON、状态与关联。网站生命周期升级会为草稿建立必填 `siteId`，知识资料复制会为不同目标网站建立独立文档。

本地自动测试使用独立 schema 和真实 Git、文件、构建、浏览器、PostgreSQL。生产数据的验收需要使用生产备份副本执行相同检查；测试数据库中的通用样例不能代替生产资料演练。

## 迁移配置

- `DATABASE_URL`：指向专用演练数据库。
- `SANDBOX_ROOT`：演练网站工作目录，保留旧网站目录和资源。
- `REMOTE_SERVICE_URL`、`REMOTE_SERVICE_TOKEN`：真实远端服务配置，用于网站工作目录的正式配置与后续协作。
- `PUBLIC_API_BASE_URL`：网站表单使用的 API 地址，本地演练可用 loopback HTTP。
- `CREDENTIALS_ENCRYPTION_KEY`：32字节 base64 AES-GCM 密钥。
- `MIGRATION_SITE_OWNERS`：JSON 对象，旧 `site_id` 对应现有账号 `account` 数组。
- `MIGRATION_KB_OWNERS`：JSON 对象，旧 `kb_id` 对应账号数组。
- `MIGRATION_KB_SITES`：旧独立知识库需要归属多个候选网站时，指定旧 `kb_id` 对应目标网站 UUID 数组。
- `MIGRATION_BOOTSTRAP_USERS`：账号初始化 CLI 使用的 `{account,name?}` 数组。
- `MIGRATION_BOOTSTRAP_CREDENTIALS_PATH`：CLI 新凭据输出路径，文件必须尚未存在，且不应进入 Git。

知识库所有者只有一个网站时自动归属该网站。所有者拥有多个网站时，需要明确 `MIGRATION_KB_SITES`。所有目标网站都需要保留原资料共享成员的访问资格；缺少归属或权限时迁移终止。

## 初始化迁移账号

旧租户数据库的所有权映射使用已经存在的本地账号。需要创建账号时，在 `services/api` 运行：

```powershell
$Root = '项目绝对目录'
$env:DATABASE_URL = 'postgres://olps:olps@127.0.0.1:5434/olps_test_migration'
$env:MIGRATION_BOOTSTRAP_USERS = '[{"account":"operator1","name":"网站运营"}]'
$env:MIGRATION_BOOTSTRAP_CREDENTIALS_PATH = Join-Path $Root '.intermediate\migration-rehearsal\credentials.json'
Set-Location (Join-Path $Root 'services\api')
npx tsx src/migration-bootstrap-users.ts
```

CLI 为新账号生成密码，凭据文件使用独占创建和仅当前用户读取的权限。已有账号保持原密码，重复执行不会覆盖凭据。凭据文件创建失败时，新账号事务不会提交。不要在日志或终端输出密码。

## 执行迁移

按根 [README.md](../README.md) 启动远端，配置演练 API 的数据库、目录、加密密钥与映射，然后从仓库根启动 API：

```powershell
$env:MIGRATION_SITE_OWNERS = '{"旧网站UUID":["operator1"]}'
$env:MIGRATION_KB_OWNERS = '{"旧知识库标识":["operator1"]}'
$env:SANDBOX_ROOT = Join-Path $Root '.intermediate\migration-rehearsal\sandboxes'
$env:REMOTE_SERVICE_URL = 'http://127.0.0.1:8790'
$env:REMOTE_SERVICE_TOKEN = '演练远端服务令牌'
Set-Location $Root
npm run start -w @olps/api
```

`server.ts` 在提供 HTTP 服务之前检查加密密钥。存在 `sites.tenant_id` 时，`migrateToCollaborationModel` 在单个数据库事务中锁定旧十表、读取业务资料、准备确定性草稿 Git 目录、建立协作结构并恢复三条序列。`cms-legacy-sandbox.ts` 检查旧页面 UUID、输入指纹、完整文件摘要、页面集合、未提交修改与符号链接；输入不一致时终止，保留旧数据库与原始文件。

随后 `migrateCmsRuntime` 升级 CMS 结构，并调用 `cms-migration.ts`、`content-conversion.ts` 与 `cms-legacy-inquiries.ts` 完成网站内容和业务资料升级。旧 flat 页面转为页面目录、共用资料与语言文件，旧 HTML 保存在单个 `core/html` 区块中。默认职责与缺少的语言内容分别补充；旧资源复制到 `assets/uploads/legacy/`，通过正式 HTML、CSS、srcset 解析库更新引用并建立媒体资料。

转换在独立目录执行真实构建、`verifySite` 和 `node tools/site-verify.mjs`，通过后替换网站内容并保存单个 Git 转换提交。目录中的 `.olps/legacy-input.json` 保存准备指纹，`source/.cms-content.json` 保存转换结果，`.olps-cache` 保存 Git 忽略的加密恢复资料。

## 恢复与重复执行

`.olps-cache/content-conversion-recovery.json` 保存 AES 密文、网站与草稿标识、加密范围。内容和 Git 提交完成后数据库事务未完成时，重新启动优先恢复凭据。旧租户准备阶段的 `.olps-cache/legacy-credentials.json` 也参与恢复。恢复需要对应的成员权限和数据库上下文，成功后清理恢复文件。

转换提交已经存在、数据库索引或草稿版本尚未更新时，运行时迁移重新验证网站并刷新索引，继续使用原提交。重复迁移不产生第二个内容转换提交，不重复创建网站、草稿、资料副本或历史询盘。

历史询盘取得稳定 `cms_id`，根据原关联页面恢复语言、内容引用与标题。联系人字段和广告来源供新版界面读取；原始资料位于 `payload.legacyPayload`，原始状态位于 `payload.legacyStatus`。状态转换为 `new`、`qualified`、`invalid`、`handled`，未知状态需要人工检查。迁移不建立邮件和营销转化任务。

旧 Google Ads 和 GA4 账户标识保存在新版 `integration_connections` 中，连接状态为 `needs_reconnect`。运营完成真实平台授权并确认追踪配置后使用新连接。网站知识资料复制后互不自动同步。

## 验收检查

1. `GET /api/health` 返回正常，账号能够登录。
2. `/api/sites` 包含迁移的网站，每份草稿都有必填 `siteId` 和正确成员。
3. 核心业务数量与迁移前基线一致，旧十表字段与对应新记录一致，三条编号序列保持原状态。
4. 原页面 UUID 与正文、媒体引用、知识资料、询盘、报告和任务能够通过新模型或正式后台接口读取。
5. 网站通过构建与独立产物验证，草稿数据库版本与 Git HEAD 一致。
6. 再次启动后 Git HEAD、已经转换的业务记录和凭据保持不变。
7. 成员失去网站权限后，公开业务历史接口和资源凭据拒绝访问。

自动测试可在仓库根执行：

```bash
npm test -w @olps/api -- src/cms-migration.integration.test.ts src/content-conversion.test.ts src/cms-legacy-inquiries.integration.test.ts src/cms-bootstrap-credentials.integration.test.ts src/migration-environment.integration.test.ts src/migration.sequence.tdd.test.ts
```

转换数量与前后业务数量记录保存在 `.intermediate/validation/cms-migration-*.json`。演练中另行保存备份说明、字段比对和异常恢复记录。网站发布和外部平台验收见 [主流程验收](flows/mvp-happy-path.md)，接口说明见 [管理 API](../services/api/docs/README.md)。
