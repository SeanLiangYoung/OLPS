# 管理 API（`@olps/api`）

管理 API 提供账号、网站、草稿、结构化内容、媒体、主题、插件、知识库、AI 任务、预览、询盘、报告、营销连接和发布接口。静态网站由独立远端和其他发布目标提供，访客表单与事件提交到管理 API。

## 运行与验证

安装与三进程启动命令见仓库根 [README.md](../../../README.md)。管理 API 从仓库根 `.env` 读取配置，默认监听 `http://127.0.0.1:8787`。`GET /api/health` 返回 `{"ok":true}`。

```bash
npm run build -w @olps/api
npm run start -w @olps/api
npm run test -w @olps/api
npm run typecheck:test -w @olps/api
```

启动前需要 `DATABASE_URL`、`REMOTE_SERVICE_URL`、`REMOTE_SERVICE_TOKEN` 和32字节 base64 `CREDENTIALS_ENCRYPTION_KEY`。网站目录配置为 `SANDBOX_ROOT`；预览目录为 `PREVIEW_ROOT`；公开表单地址使用 `PUBLIC_API_BASE_URL`。全部环境变量见 [服务配置](../../../docs/services.md)。

## 网站与内容

- `POST /api/auth/register`、`POST /api/auth/login`：注册和登录，返回 `accessToken` 与用户资料。
- `GET /api/auth/me`、`POST /api/auth/logout`：会话查询和退出。
- `GET/POST /api/sites`：网站列表和创建网站。创建请求 `{name,draftName?}` 返回网站、草稿与网站知识库，初始 `initStatus` 为 `initializing`。
- `GET /api/sites/:siteId/initialization`、`POST .../initialization/retry`：初始化查询与重试，状态为 `initializing`、`ready` 或 `failed`，失败保留原始业务错误。
- `GET/POST /api/drafts`：列出和创建编辑版本。创建请求为 `{siteId,name}`。
- `/api/sites/:siteId/owners`、`/api/drafts/:draftId/owners`：查询或增加成员，删除使用 `DELETE .../:userId`。
- `/api/drafts/:draftId/pages`、`/collections`、`/collections/:collectionId/groups`、`/items`：内容列表和内容创建。
- `/api/drafts/:draftId/content/:ref/:id?locale=en`：读取或保存 `page`、`collection`、`group`、`item` 的完整共用资料与指定语言内容。
- `/api/drafts/:draftId/media`：媒体列表和 multipart 上传；`/:mediaId/replace` 替换媒体，`/:mediaId/usages` 查询引用位置。
- `/api/drafts/:draftId/appearance`、`/themes`、`/plugins`、`/settings`：外观、主题、插件与网站设置。
- `POST /api/drafts/:draftId/locales`：添加语言并建立已有内容的语言文件。
- `/api/sites/:siteId/knowledge-base/documents`：网站知识资料；`POST .../:documentId/copy` 的 `{targetSiteIds}` 为其他网站建立独立副本。

编辑请求携带读取结果中的摘要，例如 `If-Match: "sha256:..."`。内容保存体为 `{ref,meta,locale,collectionId?}`。摘要不一致时返回冲突；普通编辑受草稿同步状态和权限限制。

## AI 与预览

`POST /api/jobs/:type` 创建十类模型任务，必须提供 `Idempotency-Key`。请求包含 `draftId`、`locale` 及任务所需目标、知识资料和要求。`GET /api/jobs/:jobId` 查询真实任务结果；`GET .../events` 提供 SSE，并支持 `Last-Event-ID` 继续读取。失败任务保持 `failed` 和业务错误。

`POST /api/drafts/:draftId/preview` 建立完整草稿网站预览。预览使用短期凭据，每次读取检查会话和成员权限。编辑器资源凭据由 `POST .../resource-access` 创建，其有效期由 `EDITOR_RESOURCE_TTL_SECONDS` 控制。完整说明见 [preview-access.md](preview-access.md)。

## 发布与协作

`POST /api/sites/:siteId/publish` 接收 `{draftId,requestKey}`。同一个发布操作在失败恢复时继续使用原 `requestKey`。托管上传前保存候选版本，响应丢失后查询真实远端版本恢复；托管成功后写入对应 Git commit 的不可变网站快照，更新网站发布状态，再处理独立发布目标和搜索通知。

- `POST /api/sites/:siteId/drafts/:draftId/pull`：取得网站更新并保留当前修改。
- `GET .../synchronization`：返回 `{syncStatus,question}`。
- `POST .../continue`：请求 `{answer}`，真实 Agent 根据运营回答继续；待处理操作为发布时继续原发布记录。
- `/api/sites/:siteId/deploy-targets`：发布目标管理，配置加密保存。
- `GET /api/sites/:siteId/publish-records`：托管、各个目标与通知结果。
- `GET .../publish-records/:recordId/download.zip`：下载该历史版本的 `public/` 和 `server-config/`。
- `POST .../publish-records/:recordId/targets/:targetId/retry`：单个目标重试。
- `POST .../publish-records/:recordId/notifications/:provider/retry`：搜索通知重试。

发布记录返回 `recordId`、`commitId`、`publicUrl`、`createdAt` 等字段，以及各个目标的 `targetId`、状态和真实上传数量。单个发布记录使用 `GET /api/sites/:siteId/publish-records/:recordId`。记录与目标列表支持 `limit`、不透明 `cursor` 和 `pageInfo`，默认每页50项，上限100项。公开网站文件可以通过 `/api/sites/:siteId/site-files` 查询，单个文件通过 `.../site-files/<path>` 读取，权限和历史版本检查由 API 完成。

## 询盘、事件与报告

访客使用 `POST /api/public/:siteId/inquiries`、`POST /api/public/:siteId/events`。询盘请求包含内容引用、语言、真实表单区块标识、联系人字段、隐私同意、广告同意、来源资料和幂等 `eventId`。公开入口只验证当前发布快照中的真实内容和表单；预览入口使用当前草稿，并与公开资料隔离。

后台通过 `/api/sites/:siteId/inquiries` 读取询盘，支持 `source`、`locale`、`status`、`q` 筛选和 `limit`、`cursor` 分页；响应包含 `inquiries`、`pageInfo`。`PATCH .../:inquiryId` 设置四种状态。邮件和营销转化使用真实发送结果；缺少配置时保持明确的等待配置或失败状态。当前报告、历史报告和报告详情使用 `/api/sites/:siteId/reports`、`/reports/history`、`/reports/:reportId`。

营销授权、账户选择、公开追踪标识和数据读取使用 `/api/drafts/:draftId/integrations/...`，具体配置见 [营销集成](../../../docs/integrations.md)。

主题激活与文件读取、插件启用与设置、媒体引用、固定字符串和添加语言的完整方法、请求体及响应见 [受管资源接口](managed-resources.md)。Google、Meta OAuth、账户选择、连接管理和指标读取的正式方法见 [营销接口](integrations.md)。

## 自定义插件 API

插件导出的 `handle(request, ctx)` 接收以下正式入口的请求方法和相对路径：

- `/api/public/:siteId/plugins/:pluginId/*`：使用网站当前发布记录对应的 Git 代码、普通设置快照和密钥密文。网站必须已经发布，插件必须启用、声明 `server.api` 并已确认服务器权限。
- `/api/preview-access/:token/plugins/:pluginId/*`：使用 capability 对应草稿的代码、设置与密钥；每次检查 capability、会话、网站成员和草稿成员权限。

请求体上限为 64,000 字节，JSON 请求解析为对象，其他正文作为字符串。`request` 包含 `method`、`path`、`query`、`headers` 和 `body`；允许传入的请求头为 `Accept`、`Accept-Language`、`Content-Type`、`Idempotency-Key`，不会传入 `Authorization` 或 `Cookie`。

插件返回 `{status,headers?,body?}`。状态范围为 `200` 至 `599`，禁止 `3xx` 重定向；允许的响应头为 `Content-Type`、`Content-Language`、`Retry-After`。正文仅支持 JSON 或 UTF-8 纯文本，默认 JSON，上限为 1 MiB。服务设置 `X-Content-Type-Options: nosniff`、`Content-Security-Policy: sandbox; default-src 'none'` 与 `Cache-Control: no-store`；插件不能设置 Cookie 或 `Location`。

`ctx.store` 需要声明 `store` 权限，数据库按网站、插件及 `public`/`preview` 来源隔离，预览继续按草稿隔离。键名最长 200 个字符，单个 JSON 值上限为 64,000 字节，每个范围最多 1,000 个键、1 MiB JSONB 内容；达到键数上限时仍可更新已有键。`ctx.inquiries.create` 需要声明 `inquiries` 权限，并验证真实内容与表单；预览询盘固定为 `preview` 来源，不创建邮件或转化任务。

插件未知、禁用、没有 API 声明或没有确认权限返回 `404 NOT_FOUND`；预览权限失效返回 `403 FORBIDDEN`；请求无效返回 `400 VALIDATION_FAILED`；执行或响应限制失败返回 `502 PLUGIN_API_FAILED`。执行上限、域名限制和日志规则见 [插件服务器代码](../../../docs/plugins.md#4-服务器代码)，正式接口规范见 [自定义插件接口](../../../docs/design/api-conventions.md#17-自定义插件-api)。

## 数据库迁移

启动顺序为常规结构初始化或 `migrateToCollaborationModel`，随后 `migrateCmsRuntime`。旧租户迁移通过 `cms-legacy-sandbox.ts` 准备确定性 Git 目录；CMS 内容由 `content-conversion.ts` 构建、验证和保存转换版本；`cms-migration.ts` 恢复索引、知识资料和营销账户；`cms-legacy-inquiries.ts` 提供可读历史询盘。

迁移配置包括 `MIGRATION_SITE_OWNERS`、`MIGRATION_KB_OWNERS`、`MIGRATION_KB_SITES`，以及账号初始化 CLI 使用的 `MIGRATION_BOOTSTRAP_USERS` 与 `MIGRATION_BOOTSTRAP_CREDENTIALS_PATH`。完整备份与专用测试库演练见 [migration-rehearsal.md](../../../docs/migration-rehearsal.md)。

真实模型成功流程使用 `npm run test:e2e:live -w @olps/admin`；完整平台和静态服务器验收使用 `npm run mvp:check`。缺少外部真实配置时验收明确失败，具体要求见 [主流程验收](../../../docs/flows/mvp-happy-path.md)。

本地 nginx 根目录、nginx 子目录和 serve 的实际 ZIP 部署验收使用 `npm run static:check -w @olps/api`，检查 HTTP、Chromium DOM、搜索和全部公开文件摘要，结果及运行条件见 [静态部署验收](../../../docs/static-deployment-rehearsal.md)。
