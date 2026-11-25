# 服务与运行方式

PostgreSQL 保存账号、会话、网站和草稿成员、内容索引、加密凭据、询盘、报告、任务与发布记录。管理 API（`services/api`）处理这些业务，并管理网站工作目录、构建、预览、协作和发布。知识库服务（`services/knowledge`，`@olps/knowledge`）以站点 Wiki 文件为权威存储，负责资料包导入、两步 Ingest、素材角色、检索与投影写入。远端服务（`services/remote`）接收经过验证的 Git bundle，保存发布历史并提供公开静态网站。管理界面（`apps/admin`）提供网站管理、可视化编辑、AI 内容助手和发布页面。

管理 API、知识库服务与远端服务可以分别部署。管理 API 从仓库根 `.env` 读取配置；远端与知识库由各自启动终端设置服务令牌与数据目录。安装、默认端口和四个进程（远端、知识库、管理 API、管理后台）启动命令见根 [README.md](../README.md)。知识库设计见 [design/knowledge-service.md](design/knowledge-service.md)；进程内环境变量见 [services/knowledge/README.md](../services/knowledge/README.md)；Agent / MCP 操作见 [knowledge-agent-skill.md](knowledge-agent-skill.md)。

## 环境变量

- `DATABASE_URL`：管理 API 使用的 PostgreSQL 连接地址。知识库进程写入 `knowledge_documents` / `knowledge_assets` / `knowledge_imports` 投影时也使用同一连接串。
- `PORT`、`PUBLIC_API_BASE_URL`：管理 API 监听端口与访客表单访问的公开 API 地址。默认本地端口为 `8787`。生产网站使用 HTTPS；本地开发支持 loopback HTTP。
- `SANDBOX_ROOT`、`PREVIEW_ROOT`、`PUBLISH_ROOT`：网站工作目录、预览目录和本地发布资料目录。相对路径从仓库根解析。
- `REMOTE_SERVICE_URL`、`REMOTE_SERVICE_TOKEN`：管理 API 访问远端的地址与服务令牌。
- `KNOWLEDGE_SERVICE_URL`、`KNOWLEDGE_SERVICE_TOKEN`：管理 API 访问知识库服务的根地址与服务间令牌；创建网站成功后调用 `POST /api/v1/projects/:siteId/project` 初始化站点 Wiki 目录。资料包导入、reviews、素材修正与建站 `promoteKnowledgeAssets` 经管理 API 转发到该服务。
- `KNOWLEDGE_ROOT`、`KNOWLEDGE_HOST`、`KNOWLEDGE_PORT`、`KNOWLEDGE_IMPORT_MAX_BYTES`、`KNOWLEDGE_IMPORT_FILE_MAX_BYTES`、`KNOWLEDGE_UPLOAD_CHUNK_BYTES`：知识库进程使用；默认根目录 `.intermediate/knowledge-data`，默认监听 `127.0.0.1:19828`，单次导入合计默认 16GB、单文件默认 2GB、分片默认 8MB。完整列表与 `KNOWLEDGE_AI_*` / `AI_*` 覆盖关系见 [services/knowledge/README.md](../services/knowledge/README.md)。
- `REMOTE_PORT`、`REMOTE_PUBLIC_BASE_URL`、`REMOTE_DATA_ROOT`：远端进程的监听端口、公开地址和版本数据目录。默认端口为 `8790`。
- `CREDENTIALS_ENCRYPTION_KEY`：必填的32字节 AES-GCM 密钥，以 base64 编码。网站插件、OAuth 和发布目标使用明确的加密范围；密钥需要与数据库备份共同妥善保管。
- `SESSION_TTL_HOURS`：登录会话有效期，默认168小时。
- `PREVIEW_CREDENTIAL_TTL_SECONDS`、`EDITOR_RESOURCE_TTL_SECONDS`：整站预览和编辑器资源访问凭据的有效期，默认均为900秒。
- `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`：真实模型服务配置。缺少密钥时生成任务保存明确错误。知识库两步 Ingest 可共用上述变量，或由 `KNOWLEDGE_AI_API_KEY` / `KNOWLEDGE_AI_BASE_URL` / `KNOWLEDGE_AI_MODEL` 覆盖。
- `CURSOR_AGENT_COMMAND`：协作冲突处理使用的本机 Cursor Agent 命令，默认 `cursor-agent`。
- `MEDIA_MAX_BYTES`、`THEME_MAX_BYTES`、`PLUGIN_MAX_BYTES`：上传文件大小限制；知识库单文件上限镜像 `MEDIA_MAX_BYTES`（默认 `20971520`）。
- `GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET`、`GOOGLE_ADS_DEVELOPER_TOKEN`、`META_APP_ID`、`META_APP_SECRET`、`OAUTH_REDIRECT_BASE_URL`：营销平台授权与接口配置，见 [integrations.md](integrations.md)。
- `SMTP_HOST`、`SMTP_PORT`、`SMTP_FROM`、`SMTP_TO`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_SECURE`：询盘邮件通知。网站表单的通知邮箱优先于默认收件地址。
- `INDEXNOW_ENABLED`：明确设置为 `true` 后才发送真实 IndexNow 请求；网站需要公开 HTTPS 地址与能够访问的密钥文件。
- `TEST_DATABASE_URL`、`E2E_DATABASE_URL`：集成测试和浏览器测试数据库，名称必须包含 `_test_`。

迁移变量为 `MIGRATION_SITE_OWNERS`、`MIGRATION_KB_OWNERS`、`MIGRATION_KB_SITES`、`MIGRATION_BOOTSTRAP_USERS`、`MIGRATION_BOOTSTRAP_CREDENTIALS_PATH`，具体含义与演练命令见 [migration-rehearsal.md](migration-rehearsal.md)。

## 构建与验证

`npm run build` 按依赖顺序构建 `domain`、`render`、`plugin-runtime`、`tracking-runtime`、`builtin-themes`、`builtin-plugins`、`sync`、`site-builder`、`connectors`、`remote`、`knowledge`、`api`、`admin`。`npm run typecheck` 构建所需基础包后检查 API、测试辅助文件和 Admin。`npm test` 执行全部工作区测试（含 `@olps/knowledge`）。

`sharp` 与 `isolated-vm` 包含原生模块，安装时需要当前平台可用的预编译文件或编译工具。`connectors` 使用 Google 和 Meta 的官方 SDK；发布目标使用相应 FTP、SFTP、S3、OSS、COS SDK。

管理 API 给 `SyncWorkspace` 提供本机 `@olps/site-builder/cli` 构建命令。网站内的 `tools/site-verify.mjs` 可以独立验证源码摘要和公开产物摘要，远端在切换公开版本之前执行验证。预览使用当前草稿的完整网站模型，见 [预览访问](../services/api/docs/preview-access.md)。

## 正式业务入口

账号使用 `/api/auth/register`、`/api/auth/login`、`/api/auth/me`、`/api/auth/logout`。登录后传递 Bearer accessToken。

`POST /api/sites` 原子创建未发布网站、第一份草稿、成员和知识库，随后异步初始化默认网站。`GET /api/sites/:siteId/initialization` 查询状态，`POST .../initialization/retry` 复用原网站和草稿重试。`POST /api/drafts` 为已有网站创建新编辑版本，要求提供 `siteId`。

内容、媒体、外观、插件和模型任务使用 `draftId`。发布使用 `POST /api/sites/:siteId/publish`，请求包含 `draftId` 和 `requestKey`。协作更新与继续处理位于 `/api/sites/:siteId/drafts/:draftId/pull` 和 `/continue`。当前协作问题通过 `/synchronization` 查询。

公开询盘与事件使用 `/api/public/:siteId/inquiries` 和 `/events`，只读取当前不可变发布快照。预览询盘使用预览凭据访问，资料与公开询盘分别保存，且不创建外部发送任务。

发布目标、记录和历史 ZIP 归属网站。托管发布完成后，启用的目标分别进行 SHA-256 增量上传；目标失败可以独立重试。缺少模型、平台、邮件或搜索通知配置时，接口或任务保存明确的错误和待配置状态。

## 独立升级

在 API 停止期间执行 `npm run upgrade -w @olps/api`，生产构建执行 `node services/api/dist/upgrade.js`。独立命令检查加密密钥，完成数据库结构、旧页面、内容索引、加密凭据、知识资料、历史询盘和营销账户升级。全部成功后写入 `cms_upgrade_state`。同版本升级重复执行直接完成，数据与完成记录保持不变；并发升级命令会明确失败。

`server.ts` 在提供 HTTP 服务之前只检查加密密钥和升级完成记录。空数据库、升级失败、升级未完成或版本不匹配时立即终止启动，提示执行独立升级命令。生产 HTTP 模块不加载旧格式转换程序。

迁移转换在独立目录完成构建与独立验证，成功后保存单个 Git 内容转换提交。业务数量与转换结果保存在 Git 忽略的验证目录。旧租户迁移的数据库结构事务、内容转换和恢复步骤见 [迁移演练](migration-rehearsal.md)。

主流程完整外部验收使用 `npm run mvp:check`；真实模型浏览器验收使用 `npm run test:e2e:live -w @olps/admin`。所需真实配置和20步检查见 [主流程验收](flows/mvp-happy-path.md)。
