# 环境与前置条件

适用分支：`sean/wp-style-cms`。核对日期：2026-11-21。本文记录基础运行、完整测试、外部服务验收和生产迁移需要准备的环境。配置字段以仓库根 [.env.example](../.env.example) 和相应服务代码为准。

## 1. 本机工具与系统

基础运行需要：

- Node.js 24 或更新版本，配套 npm；项目使用 npm workspaces。
- Git，可供服务创建网站仓库、保存版本和执行协作操作。
- PostgreSQL。仓库 Docker Compose 使用 `postgres:16-alpine`，主机端口为 `5434`，容器内端口为 `5432`。
- Python 和 C++ 编译工具，用于安装可能需要编译的 `isolated-vm` 等原生依赖。macOS 使用 Xcode Command Line Tools，Windows 使用 Visual Studio Build Tools。
- 可读写的网站、预览和远端数据目录。生产使用的数据库、网站目录、远端 Git 历史和加密密钥需要共同保存。

完整自动测试还需要：

- Docker CLI 和正在运行的 Docker 服务；能够取得实际 OpenSSH SFTP、RustFS 和 nginx 测试镜像。
- Playwright Chromium，执行 `npx playwright install chromium` 安装。
- FFmpeg，默认通过 `ffmpeg` 调用；可以用 `FFMPEG_COMMAND` 指定命令位置。
- OpenSSL，支持测试中的 `openssl req -addext`，用于生成 FTPS 测试证书。
- PostgreSQL `pg_dump` 客户端，支持 `--restrict-key`；本次测试使用 `pg_dump 18.3`，连接 PostgreSQL `16.13`。
- `zip`、`unzip`，用于真实压缩包安装及静态部署验收。
- 可用且已经登录的 Cursor Agent；默认命令为 `cursor-agent`，可以用 `CURSOR_AGENT_COMMAND` 指定。协作测试调用实际 Agent。
- 能够访问 npm、所需容器镜像和实际外部服务的网络。真实 Meta SDK 测试还需要 Chromium 能够访问 `connect.facebook.net`。

本次完整测试记录的版本为 Node.js `24.21.0`、npm `11.19.0` 和 Chromium `159.0.8154.6`。这些是验证记录，其他版本需要在目标环境执行检查。

## 2. 三个服务与数据库

- 管理 API：默认 `127.0.0.1:8787`，处理账号、内容、预览、询盘、任务和发布。
- 管理后台：开发环境默认 `127.0.0.1:5173`，通过 Vite 代理访问 API。
- 独立远端服务：默认端口 `8790`，接收网站 Git bundle，保存发布版本并提供静态网站。
- PostgreSQL：默认主机地址 `127.0.0.1:5434`。开发库示例名称为 `olps`，专用测试库为 `olps_test_api`。

管理 API 和独立升级命令读取仓库根目录 `.env`。远端服务需要在启动终端设置环境变量。后台开发代理通过启动终端的 `OLPS_API_PROXY_URL` 指向 API，默认使用 `http://127.0.0.1:8787`。

使用其他端口时，分别核对 `PORT`、`PUBLIC_API_BASE_URL`、`ADMIN_PUBLIC_BASE_URL`、`REMOTE_SERVICE_URL`、`REMOTE_PUBLIC_BASE_URL` 和后台代理地址。浏览器测试另用 `OLPS_API_URL`、`OLPS_ADMIN_URL` 指定实际服务地址。

## 3. 基础运行配置

在仓库根目录根据 `.env.example` 创建 `.env`，准备以下值：

- `DATABASE_URL`：实际 PostgreSQL 数据库连接。
- `CREDENTIALS_ENCRYPTION_KEY`：32 字节随机值的 Base64 编码，用于插件、OAuth 和发布目标凭据加密。已有数据库需要使用对应的原密钥。
- `REMOTE_SERVICE_URL`：API 可以访问的远端服务地址。
- `REMOTE_SERVICE_TOKEN`：与远端进程一致的服务令牌。
- `PUBLIC_API_BASE_URL`：生成的网站提交询盘和事件时访问的 API 地址。
- `ADMIN_PUBLIC_BASE_URL`：管理后台访问地址，用于需要返回后台的流程。
- `SANDBOX_ROOT`：网站编辑目录。
- `PREVIEW_ROOT`：预览产物目录。
- `PUBLISH_ROOT`：本地发布资料目录。

远端进程的启动终端需要准备：

- `REMOTE_SERVICE_TOKEN`：与管理 API 配置一致。
- `REMOTE_PUBLIC_BASE_URL`：浏览器可以访问的远端公开地址。
- `REMOTE_PORT`：监听端口，默认 `8790`。
- `REMOTE_DATA_ROOT`：持久保存网站仓库和公开版本的目录。

本地示例令牌、账号和数据库密码用于开发环境。部署时填写环境实际使用的配置。私密值通过本机配置或部署环境提供，本文只记录字段名称和用途。

## 4. 安装、独立升级和启动顺序

在仓库根目录安装并构建：

```bash
docker compose up -d
npm ci --include=optional
npm run build
```

完成 `.env` 配置并启动远端服务后，在 API 停止期间执行：

```bash
npm run upgrade -w @olps/api
npm run start -w @olps/api
```

使用编译产物部署时，独立升级入口为：

```bash
node services/api/dist/upgrade.js
```

升级命令负责数据库结构初始化、旧网站转换和业务资料升级。全部成功后保存 `cms_upgrade_state` 完成记录。服务启动只检查完成记录；未升级、升级未完成或版本不匹配时立即退出。

开发时 API 使用 `npm run dev -w @olps/api`，后台使用 `npm run dev -w @olps/admin`。远端终端的完整启动方式见根 [README.md](../README.md#本地运行)。

启动完成后检查 `GET /api/health` 返回 `{"ok":true}`，浏览器打开管理后台并注册或登录。首次创建网站需要等待初始化完成，随后可以维护内容、预览和发布。

## 5. 自动测试前提与命令

专用测试数据库名称必须包含 `_test_`。使用仓库 Compose 时创建测试库：

```bash
docker compose exec postgres createdb -U olps olps_test_api
npx playwright install chromium
```

API 集成测试读取进程环境中的 `TEST_DATABASE_URL`，默认连接 `postgres://olps:olps@127.0.0.1:5434/olps_test_api`。测试辅助程序会创建和清理独立 Schema，数据库账号需要相应权限。浏览器专用服务可用 `E2E_DATABASE_URL` 指定测试库。

迁移权限专项还会创建和删除测试角色，并执行 `GRANT`、`REVOKE`。测试管理连接需要创建角色及相应授权权限；准备数据库时需要检查这些权限。

完整检查命令：

```bash
npm run build
npm run typecheck
npm test
npm run test:docs
npm run test:cms-docs
npm run check:docs
```

常规 Chromium 管理流程：

```bash
npm run test:e2e -w @olps/admin
```

该命令需要对应的 API、后台、远端服务和数据库已经就绪。非默认地址需在启动测试前设置 `OLPS_API_URL`、`OLPS_ADMIN_URL`，后台代理同时设置 `OLPS_API_PROXY_URL`。部分专用浏览器流程会自行启动隔离服务，运行时需要对应端口空闲。

本地 nginx 根目录、nginx 子目录和 serve 部署验收：

```bash
npm run static:check -w @olps/api
```

该静态专项需要已构建的项目、Docker、Chromium 和 `unzip`，可以独立于数据库、模型与营销账户执行。实际 Meta SDK 专项为 `npm run test:sdk-live -w @olps/tracking-runtime`。详细范围见[静态部署验收](static-deployment-rehearsal.md)。

## 6. 模型与协作服务

AI 内容生成需要 `AI_API_KEY`、`AI_BASE_URL` 和 `AI_MODEL`，模型服务须兼容当前 API 调用方式。默认配置见 [.env.example](../.env.example) 与[模型配置](model-defaults.md)。

真实模型浏览器命令为 `npm run test:e2e:live -w @olps/admin`，测试进程需要取得模型配置，对应管理 API 也需要使用可用的真实模型配置。缺少密钥时验收失败；常规测试中的任务失败保护通过不代表模型成功验收。

Cursor Agent 用于协作冲突处理，与内容生成模型配置分别准备。运行服务和测试的用户需要能够调用已登录的 Agent，并能够完成真实合并、内容构建和验证。

## 7. Google、Meta 与地图

Google 配置需要 `GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET`、`OAUTH_REDIRECT_BASE_URL`；Ads 相关操作另需 `GOOGLE_ADS_DEVELOPER_TOKEN`。准备有实际访问权限的 Ads 账户、GA4 媒体资源和 Search Console 网站。

Meta 配置需要 `META_APP_ID`、`META_APP_SECRET`、`OAUTH_REDIRECT_BASE_URL`，以及可以授权访问的 Pixel 和广告账户。平台应用中登记的回调地址分别为：

- Google：`<OAUTH_REDIRECT_BASE_URL>/api/integrations/oauth/google/callback`。
- Meta：`<OAUTH_REDIRECT_BASE_URL>/api/integrations/oauth/meta/callback`。

代码要求 OAuth 回调使用 HTTPS 或本机 HTTP 地址。后台需要完成真实授权、账户选择和追踪配置。接口、同意设置和平台结果的要求见[营销集成](integrations.md)。

独立连接器验收命令为 `npm run test:live -w @olps/connectors`，其进程环境还需要：

- `GOOGLE_LIVE_AUTHORIZATION_CODE`、`GOOGLE_LIVE_PKCE_VERIFIER`。
- `META_LIVE_AUTHORIZATION_CODE`、`META_LIVE_PIXEL_ID`、`META_LIVE_AD_ACCOUNT_ID`、`META_TEST_EVENT_CODE`。
- `GA4_LIVE_PROPERTY_ID`、`GOOGLE_ADS_LIVE_CUSTOMER_ID`。
- `LIVE_SITE_URL`、`LIVE_SITE_ID`、`LIVE_CONTACT_EMAIL`、`LIVE_METRICS_DATE`。
- `GOOGLE_LIVE_GCLID`：测试广告实际产生的点击标识。

授权码及其有效期按实际平台授权流程准备；Google 的 PKCE verifier 需要与产生授权码的流程一致。平台回执、事件 ID 和每日指标结果用于证明真实验收完成。

Google Maps 插件另外需要有效的 Maps Embed API 浏览器公开 key，在插件的 `browserApiKey` 设置中填写，并按实际发布地址设置允许范围。地图实际内容仍需在目标网站确认。

## 8. 邮件、发布目标与静态托管

询盘邮件需要可用 SMTP 服务及收件地址：`SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_FROM`、`SMTP_TO`；需要登录时另设 `SMTP_USER`、`SMTP_PASSWORD`。网站表单配置的通知邮箱优先于默认收件地址。

发布目标在管理后台配置，并以加密形式保存：

- FTP、FTPS：服务器地址、端口、用户名、登录凭据和网站目录。FTPS 还需要客户端可以验证的服务器证书；配置支持提供 `ca`。
- SFTP：服务器地址、端口、用户名、密码或私钥、网站目录和 `hostKeySha256`；支持指定 `hostKeyAlgorithm`。
- S3：`bucket`、`region`、`accessKeyId`、`secretAccessKey`；按实际服务设置 `endpoint`、`prefix`、`forcePathStyle`、`sessionToken`。
- OSS：存储桶、区域、访问凭据，按需提供服务地址、目录前缀及临时授权令牌。
- COS：存储桶、区域、访问凭据，按需提供目录前缀及临时授权令牌。

目标账号需要读取目标信息、上传文件和删除本应用管理文件的权限。服务器或存储桶还需提供实际静态网站访问方式；S3 协议上传通过与 website endpoint 的浏览器行为分别验收。

七个部署环境为 nginx 根目录、nginx 子目录、serve、Windows/IIS、S3 静态网站端点、OSS 和 COS。需要准备各自的网站公开地址、目录首页、404 处理和旧地址跳转配置，使用相同 ZIP 检查多语言、搜索、分页、详情及辅助文件。服务器配置文件位于产物的 `server-config/`。

IndexNow 实际发送需要 `INDEXNOW_ENABLED=true`、公开 HTTPS 网站地址和可访问的验证 key 文件。

## 9. 完整业务验收专用配置

执行 `npm run mvp:check` 前，准备专用验收网站，在后台完成 Google、Meta 授权与账户选择，并设置：

- `MVP_CHECK_ACCOUNT`、`MVP_CHECK_PASSWORD`、`MVP_CHECK_SITE_ID`、`MVP_CHECK_DRAFT_ID`。
- `MVP_GCLID`：实际广告点击标识。
- `MVP_SFTP_CONFIG`、`MVP_S3_CONFIG`：真实发布目标的 JSON 配置。
- `MVP_NGINX_BASE_URL`、`MVP_IIS_BASE_URL`、`MVP_SERVE_BASE_URL`：部署后的实际访问地址。
- `MVP_STATIC_DEPLOY_COMMAND_JSON`：部署程序及参数的 JSON 数组。验收脚本追加 ZIP 路径和解压目录，部署程序负责实际更新对应服务器并应用配置。

模型、平台、邮件和发布目标配置需要同时可用，执行完[主流程的 20 个步骤](flows/mvp-happy-path.md)。结果保存于 `.intermediate/mvp-check/`，包含逐步结果、平台原始返回和网站 ZIP。

## 10. 生产迁移资料

需要同一时间点的完整数据库备份、网站目录、资源文件和对应加密密钥。在独立测试数据库和独立目录恢复副本，保留原始资料。

准备旧网站和知识资料的归属映射：`MIGRATION_SITE_OWNERS`、`MIGRATION_KB_OWNERS`、`MIGRATION_KB_SITES`。需要初始化账号时，使用 `MIGRATION_BOOTSTRAP_USERS` 和 `MIGRATION_BOOTSTRAP_CREDENTIALS_PATH` 指定资料及凭据输出位置。

运行独立升级前记录用户、网站、草稿、询盘、报告和任务数量，以及原始字段、编号序列和 Git HEAD。升级后比较记录、页面、媒体、知识资料、权限和网站 build/verify 结果，并重复执行升级确认没有额外变化。具体命令见[迁移演练](migration-rehearsal.md)。

## 11. 当前验收状态与待提供资料

当前逐项记录为 30 项已验证、7 项待外部验收，详见[37 项验收记录](validation/cms-task-acceptance.md)。完整测试为 136 份文件、450 项通过，详见[验证记录](validation/2026-11-21-cms.md)。

后续需要提供或指定保存位置的资料：

- 真实模型配置，以及运行测试和 API 的环境名称。
- Google、Meta 应用与账户配置，实际授权和平台测试资料。
- 有效 Maps Embed API 公开 key 与允许的实际网站地址。
- 云端存储桶、发布权限、静态网站端点和 Windows/IIS 验收环境。
- 原始生产备份、网站目录、加密密钥及归属映射。
- 完整业务验收网站、账号、广告点击标识和部署程序配置。

交接时记录配置文件路径、服务地址、负责账号、访问方式和所对应的网站；私密值保存在受控配置中。真实服务、云端部署与生产数据验收取得结果后，再更新对应任务状态。
