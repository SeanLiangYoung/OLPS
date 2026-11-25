# 管理 API 规约

本文件定义管理 API 与管理界面、CLI、静态网站之间的通用通信格式。各业务路由继续由专题文档说明。

## 1. 基础规则

- 请求和响应使用 UTF-8 JSON；媒体与 zip 上传使用 `multipart/form-data`。
- 字段名使用 camelCase，时间使用 UTC ISO 8601，ID 使用领域模型中的 UUID。
- 管理接口使用 `Authorization: Bearer <accessToken>`。
- 访客接口只接受构建产物中写入的 `siteId` 或预览 capability。
- 内容写接口必须在草稿写入锁内完成权限检查、文件校验、Git 保存和数据库索引更新。
- JSON 请求体含未声明字段时返回 400。

## 2. 成功响应

单个资源使用资源名称作为键：

```json
{
  "page": {
    "pageId": "17fa1c4f-cf9e-44d4-aa77-5e8366a55097"
  }
}
```

资源列表使用复数名称，并带分页信息：

```json
{
  "pages": [],
  "pageInfo": {
    "nextCursor": null,
    "hasNextPage": false
  }
}
```

创建成功返回 201，读取与修改成功返回 200，删除成功返回 204。

## 3. 错误响应

```ts
type ApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'REVISION_CONFLICT'
  | 'RESOURCE_IN_USE'
  | 'DRAFT_BUSY'
  | 'DRAFT_CONFLICT'
  | 'BUILD_FAILED'
  | 'REMOTE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

type ApiErrorResponse = {
  error: string
  code: ApiErrorCode
  details?: Record<string, unknown>
}
```

示例：

```json
{
  "error": "媒体仍被 3 个内容对象引用",
  "code": "RESOURCE_IN_USE",
  "details": {
    "usages": [
      {
        "ref": "page",
        "id": "17fa1c4f-cf9e-44d4-aa77-5e8366a55097",
        "locale": "en",
        "path": "blocks[1].props.image"
      }
    ]
  }
}
```

HTTP 状态与错误码：

| HTTP | 错误码 |
|------|--------|
| 400 | `VALIDATION_FAILED`、`BUILD_FAILED` |
| 401 | `AUTH_REQUIRED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `REVISION_CONFLICT`、`RESOURCE_IN_USE`、`DRAFT_BUSY`、`DRAFT_CONFLICT` |
| 429 | `RATE_LIMITED` |
| 503 | `REMOTE_UNAVAILABLE` |
| 500 | `INTERNAL_ERROR` |

校验错误的 `details`：

```json
{
  "issues": [
    {
      "path": "fields[2].referenceCollectionId",
      "message": "reference 字段必须指定内容类型"
    }
  ]
}
```

## 4. 分页、筛选与排序

- 列表接口使用 `limit` 与 `cursor`，`limit` 默认 50，范围为 1 到 100。
- `cursor` 是 API 生成的不透明字符串，客户端不能解析。
- 搜索使用 `q`，语言使用 `locale`，状态使用 `status`。
- 排序字段由各接口列出；不接受任意数据库列名。
- 内容树接口可以返回全部分组，不使用分页；条目列表仍使用游标分页。

## 5. 修改并发

内容读取响应带 `revision`：

```json
{
  "page": {},
  "revision": "sha256:8e481f..."
}
```

- `revision` 是对象全部受管文件内容摘要，与 Git commit 无关。
- `PUT`、`PATCH`、`DELETE` 必须发送 `If-Match: "<revision>"`。
- 摘要不一致时返回 409 `REVISION_CONFLICT`，并在 `details.currentRevision` 中返回当前值。
- 新建对象不需要 `If-Match`。
- 排序操作请求带参与排序的父对象 `revision`，防止覆盖其他成员刚完成的顺序调整。

## 6. 幂等规则

- AI Job 必须带 `Idempotency-Key`；同一用户、同一路由、同一键在 24 小时内返回同一操作记录。相同键对应的请求体不同则返回 409 `REVISION_CONFLICT`。
- 发布请求在请求体中提供 `requestKey`，重复请求恢复同一次发布记录及其尚未完成的步骤。
- Pull 在草稿锁内同步同一远端版本，重复请求不会重复合并已经同步的版本。
- 发布目标重试按文件摘要增量上传，已经成功上传且内容未变化的文件不会重复发送。
- 访客询盘使用 `eventId` 返回同一次提交结果。
- 资料复制每次明确操作创建独立文档，返回新文档的标识。
- 普通内容保存依赖 `If-Match`，不使用幂等键。

## 7. 网站与草稿

### 7.1 新建网站

`POST /api/sites`

```json
{
  "name": "Acme Manufacturing",
  "draftName": "Main draft"
}
```

```json
{
  "site": {
    "siteId": "1f6a93e3-c058-4c98-b89c-a80a79ba4f11",
    "name": "Acme Manufacturing",
    "status": "unpublished"
  },
  "draft": {
    "draftId": "af999cf1-44d5-4931-8515-6c17f584bf68",
    "siteId": "1f6a93e3-c058-4c98-b89c-a80a79ba4f11",
    "initStatus": "initializing"
  }
}
```

创建过程：

1. 在一个数据库事务中创建 `sites`、`site_owners`、`site_drafts`、`draft_owners` 和网站知识库。
2. 初始化 sandbox、必备页面、预设内容类型、内置主题与插件。
3. 初始化成功后把 `initStatus` 改为 `ready`；失败时改为 `failed` 并保存原始错误。

`GET /api/sites/:siteId/initialization` 返回首份草稿的 `draftId`、`initStatus` 和 `error`。网站成员可以使用 `POST /api/sites/:siteId/initialization/retry` 重试初始化；网站 ID、草稿 ID 和知识库 ID 保持不变，成功后返回 `ready`。初始化期间和失败时，编辑入口显示当前状态及错误信息。

`POST /api/drafts` 只用于给已有网站创建另一份草稿，请求必须含 `siteId`。

## 8. 内容保存

共用文件和语言文件分别读取，但编辑器可以通过聚合接口取得完整对象：

`GET /api/drafts/:draftId/content/:ref/:id?locale=en`

```json
{
  "content": {
    "ref": "page",
    "meta": {},
    "locale": {}
  },
  "revision": "sha256:8e481f..."
}
```

`PUT /api/drafts/:draftId/content/:ref/:id?locale=en` 在一次操作中保存共用字段和当前语言字段。API 按对象类型写入对应文件，完成全部校验后更新索引。

专题接口继续用于列表、新建、删除和树形操作：

```text
GET/POST         /api/drafts/:draftId/pages
GET/PUT/DELETE   /api/drafts/:draftId/pages/:pageId
GET/POST         /api/drafts/:draftId/collections
GET/PUT/DELETE   /api/drafts/:draftId/collections/:collectionId
GET/POST         /api/drafts/:draftId/collections/:collectionId/groups
GET/POST         /api/drafts/:draftId/collections/:collectionId/items
POST             /api/drafts/:draftId/collections/:collectionId/reorder
```

删除规则：

- 必备页面返回 409 `RESOURCE_IN_USE`。
- 有子分组的分组返回 409。
- 被站内链接、菜单、字段或区块引用的对象返回 409，并列出引用位置。
- 内容类型含分组或条目时不能删除。

## 9. 内容类型不兼容修改

修改内容类型时，API 比较新旧定义。以下变化在存在内容时返回 409 `RESOURCE_IN_USE`：

- 减少或调整 `levels` 顺序。
- 删除字段。
- 修改字段 `type` 或 `translatable`。
- 修改 `referenceCollectionId`。

`details` 返回受影响分组、条目数量与前 100 个对象引用。运营处理完内容后再次保存。

## 10. 当前草稿整站预览

`POST /api/drafts/:draftId/preview`

请求：

```json
{
  "locale": "en",
  "target": {
    "ref": "page",
    "id": "17fa1c4f-cf9e-44d4-aa77-5e8366a55097"
  },
  "returnPath": "/content/page/17fa1c4f-cf9e-44d4-aa77-5e8366a55097?locale=en"
}
```

- `target` 可省略；省略时打开该语言首页。
- `returnPath` 可省略；必须是管理界面同源的 `/` 开头路径，不能含协议、域名和 `//`。
- 每次构建当前草稿中全部页面、内容类型、分组和条目，包括 `draft` 状态对象。
- 站内链接在预览中指向同一 capability 下的目标地址。
- 预览使用当前主题、插件、设置和媒体。

响应：

```json
{
  "previewUrl": "/preview-access/2Zp7.../en/contact/",
  "expiresAt": "2026-11-20T03:00:00.000Z"
}
```

capability 绑定 `sessionId`、`userId`、`draftId`、`returnPath` 和构建产物目录。默认有效期 15 分钟。

### 10.1 预览访问

- `GET /preview-access/:token/*` 提供 HTML 和资源。
- 每个 HTML 顶部注入 admin bar，显示「返回后台」与当前用户。
- 公开构建不包含 admin bar。
- capability 过期、会话过期或用户失去草稿权限时返回 403。
- 响应使用 `Cache-Control: no-store` 和 `Referrer-Policy: no-referrer`。
- 完整预览的响应使用 CSP `sandbox allow-scripts allow-forms allow-top-navigation-by-user-activation`，主题与插件脚本无法读取后台同源存储。

### 10.2 预览询盘

`POST /api/preview-access/:token/inquiries`

- 表单提交保存到当前 `draftId`，`siteId` 使用草稿所属网站。
- 询盘标记 `source: "preview"`，不会发送通知、营销转化或第三方事件。
- 后台询盘列表默认排除预览询盘，可以通过筛选器显示。
- 请求仍执行字段、隐私同意和频率限制校验。

## 11. 知识库

每个网站只有一个知识库。管理 API 对浏览器暴露下列门面；写路径转发 `@olps/knowledge`，读列表来自 Postgres 投影。服务间约定见 [knowledge-service.md](knowledge-service.md) 与 [services/knowledge/README.md](../../services/knowledge/README.md)。

```text
GET                  /api/sites/:siteId/knowledge-base
GET/POST             /api/sites/:siteId/knowledge-base/documents
GET/PUT/DELETE       /api/sites/:siteId/knowledge-base/documents/:documentId
POST                 /api/sites/:siteId/knowledge-base/documents/:documentId/copy
POST                 /api/sites/:siteId/knowledge-base/imports
GET                  /api/sites/:siteId/knowledge-base/imports/:importId
POST                 /api/sites/:siteId/knowledge-base/imports/sessions
GET                  /api/sites/:siteId/knowledge-base/imports/sessions/:uploadId
PUT                  /api/sites/:siteId/knowledge-base/imports/sessions/:uploadId/chunks/:index
PUT                  /api/sites/:siteId/knowledge-base/imports/sessions/:uploadId/files/:fileIndex/chunks/:index
POST                 /api/sites/:siteId/knowledge-base/imports/sessions/:uploadId/complete
GET                  /api/sites/:siteId/knowledge-base/reviews
POST                 /api/sites/:siteId/knowledge-base/reviews/:reviewId/resolve
GET                  /api/sites/:siteId/knowledge-base/graph
GET                  /api/sites/:siteId/knowledge-base/assets
PATCH                /api/sites/:siteId/knowledge-base/assets/:assetId
```

文档列表响应可附带 `assets: [{ assetId, role }]`，供 AI 建站页统计关联素材。

大包导入走分片会话：`POST .../imports/sessions`（`kind=zip|files`，`totalBytes`，files 模式附带 `{relativePath,size}[]`）→ 多次 `PUT` 二进制分片（可选 `X-Chunk-Sha256`）→ `POST .../complete` 返回 202 与 `importId`。中断后可按同一会话续传。默认上限：合计 16GB、单文件 2GB、分片 8MB（环境变量可调）。

小包仍可用 `POST .../imports` JSON：二者选其一 `zipBase64`，或 `files: [{ relativePath, contentBase64 }]`；可选 `sourceName`、`draftId`。接受后返回 202 与 `importId`；客户端轮询导入状态。超限、坏 zip、空包、非法路径返回 400 与明确 `code`。

`PATCH .../assets/:assetId` 请求体可含 `role`、`caption`、`roleReason`（至少一项）。成功后投影与 `wiki/assets-catalog.md` 同步。

复制请求：

```json
{
  "targetSiteIds": [
    "3243996f-af4e-47ab-8a22-55cc6b34023f"
  ]
}
```

- 用户必须同时是来源网站与全部目标网站的成员。
- 每个目标网站创建独立资料，返回新 `documentId`。
- 复制操作不建立后续同步关系。
- 知识库服务不可达或令牌错误时，导入与 reviews/assets 代理返回 503 `KNOWLEDGE_UNAVAILABLE`。

## 12. Job

`POST /api/jobs/:type` 返回 202：

```json
{
  "job": {
    "jobId": "29f4109d-c355-469c-bc2e-09ab3ad74734",
    "type": "generate_node",
    "status": "queued"
  }
}
```

Job 请求必须含 `draftId`，服务端从草稿取得 `siteId` 和该网站知识库。请求中的 `knowledgeDocumentIds` 可选；未提供时不读取知识库，也不加载 `knowledgeAssets`。提供时快照含文档正文与关联素材清单；生成内容写入草稿前执行 `promoteKnowledgeAssets`，将 `{ assetId }` 提升为当前草稿的 `{ mediaId }`。

SSE：

```text
GET /api/jobs/:jobId/events
Last-Event-ID: <eventId>
```

事件格式由 [state-models.md](state-models.md) 定义。

## 13. 发布

`POST /api/sites/:siteId/publish`

- 请求为 `{ "draftId": "...", "requestKey": "..." }`，两个字段均为 UUID；`requestKey` 用于重复请求识别。
- API 根据变化执行完整构建或资源专用构建，完成校验后进入 Git Push 流程；资源专用构建需要已有基础发布版本。
- 首次成功发布把网站状态改为 `published`。
- 响应返回操作记录；长操作进度通过 SSE 或发布对话框轮询取得。

发布目标只上传同一次发布的 `public/`，`server-config/` 随历史 ZIP 提供，由目标服务器配置使用。目标上传不能再次读取正在变化的草稿。发布响应、发布记录与目标结果使用 `recordId`、`publicUrl`、`targetId` 等 camelCase 字段；发布记录和目标列表使用 `limit`、`cursor`、`pageInfo`。

同步和冲突处理接口：

```text
POST /api/sites/:siteId/drafts/:draftId/pull
GET  /api/sites/:siteId/drafts/:draftId/synchronization
POST /api/sites/:siteId/drafts/:draftId/continue
```

## 14. 访客询盘

`POST /api/public/:siteId/inquiries`

```json
{
  "target": {
    "ref": "page",
    "id": "17fa1c4f-cf9e-44d4-aa77-5e8366a55097"
  },
  "locale": "en",
  "formId": "contact-main",
  "fields": {
    "name": "Alex",
    "email": "alex@example.com",
    "message": "Please send a quotation."
  },
  "privacyConsent": true,
  "attribution": {},
  "eventId": "e5d93ddb-befb-44c9-a750-c308b742b020"
}
```

成功返回 201：

```json
{
  "inquiryId": "84032398-aaae-4b77-ab69-c3ed90c74b4d",
  "redirectUrl": "../thank-you/"
}
```

- API 根据网站当前发布版本校验 `target` 与表单定义。
- `eventId` 在网站范围内唯一，重复提交返回第一次结果。
- `redirectUrl` 是当前语言询盘成功页的相对地址。

后台列表使用 `GET /api/sites/:siteId/inquiries`，支持 `source=public|preview`、`locale`、四种 `status`、`q` 和通用游标分页。来源默认为 `public`，搜索作用于姓名、邮箱、正文与来源内容标题。响应为 `{inquiries,pageInfo}`。处理状态使用 `PATCH .../:inquiryId`；通知或转化发送重试使用 `POST .../:inquiryId/deliveries/:taskId/retry`。

## 15. 全站检查报告

```text
GET /api/sites/:siteId/reports?draftId=:draftId
GET /api/sites/:siteId/reports/history
GET /api/sites/:siteId/reports/:reportId
```

网站成员通过 `draftId` 选择有权访问的编辑版本；省略时使用最近更新的可访问版本。每次检查页面、内容列表、分组和条目的全部语言，使用共享渲染与编辑器 SEO 检查规则，执行构建检查，并核对站内链接与标题位置。

检查响应包含 `reportId`、`draftId`、`createdAt`、`summary`、`content` 和 `issues`。`summary` 提供 `total`、`affected` 和 `issues` 数量；每份内容提供目标引用、语言、标题、公开询盘数量和问题清单。结果保存到 `reports`，历史接口同时保留迁移记录；历史记录中的 `legacy` 标记表示旧报告清单。

## 16. 网站概况与营销指标

```text
GET /api/sites/:siteId/overview?draftId=:draftId&locale=en
GET /api/sites/:siteId/marketing-metrics?draftId=:draftId
```

两个接口均检查网站成员权限和所选草稿权限。概况接口要求 `draftId`，使用索引表的 SQL 总数返回当前语言的页面、内容类型、分组和条目数量。营销指标使用最近 30 个 UTC 日期，含当前日期；未发布网站读取所选草稿的连接范围，已发布网站读取网站范围。

营销响应提供 `period`、`platforms`、`native` 和 `inquiries`。没有同步记录的平台使用 `status: "not_synced"`，指标值为 `null`；已同步日期没有流量时可以返回实际零值。平台同时提供 `availableDays`、`expectedDays` 和每项指标的有效天数。

- GA4：按 `totals.metricHeaders` 对应读取 `metricValues`，分别返回每日活跃用户累计、会话、页面浏览和关键事件。每日活跃用户累计不代表 30 天内去重用户。
- Google Ads：读取 `metrics` 与 `customer.currency_code`，将 `cost_micros` 换算为对应币种单位，分别提供转化与花费。
- Meta：读取 `spend`、`account_currency` 与 `actions`。平台线索、网站线索和站内线索分别显示，不相加。
- Search Console：分别提供点击与展示。
- 原生页面浏览来自 `cms_public_events` 的 `page_view`，标准浏览器流程仅在访客同意统计后发送。
- 公开询盘按创建日期计数，排除 `source=preview`；有效数量包括当前 `qualified` 和已经产生有效询盘处理记录后变为已处理的询盘。

广告来源使用询盘保存的 `attribution`。Google 点击标识或 Google 付费来源标签计入 Google；Meta 点击标识或 Meta 付费来源标签计入 Meta。仅有 `fbp` 不构成广告来源，同时含两类点击标识的询盘单独计数。平台日报以平台返回日期为准，询盘按 UTC 创建日期对应；日期边界可能受平台账户时区影响。

`spend` 按平台和币种分组；没有币种的花费放入 `unknownSpend` 逐日显示，不合计。每条来源询盘成本使用同一币种已同步日期的花费，除以相同日期对应来源的公开询盘数量。有效来源询盘成本使用其中已标记有效数量。没有来源询盘、同期缺少花费金额或存在币种冲突时，成本返回 `null` 和说明。这些成本与广告平台归因转化成本分别解释。

外部账户授权与实际取数需要使用真实 GA4、Google Ads、Meta 和 Search Console 账户验收；本地数据库与浏览器检查不代表第三方同步已完成。

## 17. 自定义插件 API

```text
/api/public/:siteId/plugins/:pluginId/*
/api/preview-access/:token/plugins/:pluginId/*
```

两个入口把 HTTP 方法与插件内相对路径传给 `server/api.js` 导出的 `handle(request, ctx)`。公开入口使用网站当前发布记录关联的 Git commit、普通配置快照和密钥密文；草稿后续修改不改变公开行为。网站必须处于 `published` 状态。插件需要启用、声明 `server.api`，并且已经确认服务器权限。

预览入口使用 capability 对应草稿的当前文件、设置与密钥，每次验证 capability、登录会话、网站成员和草稿成员权限。预览 token 过期、会话失效或成员权限撤销后拒绝访问。

### 17.1 请求与响应

`request` 包含 `method`、`path`、`query`、`headers` 和 `body`。`path` 为插件入口之后的相对路径，空路径表示 `/`；请求体上限为 64,000 字节。`application/json` 正文解析为 JSON，其他正文作为字符串，没有正文时为 `null`。

请求头白名单为 `Accept`、`Accept-Language`、`Content-Type`、`Idempotency-Key`，传给插件时使用小写键名。`Authorization`、`Cookie` 和其他请求头不会传入插件。

插件返回 `{status,headers?,body?}`：

- `status` 必须为 `200` 至 `599` 的整数，禁止 `300` 至 `399`；`204` 和 `205` 不返回正文。
- `headers` 只允许 `Content-Type`、`Content-Language`、`Retry-After`，名称不区分大小写，值禁止换行。`Content-Type` 仅允许 `application/json` 或 `text/plain`，可声明 UTF-8 编码；默认返回 JSON。
- `body` 上限为 1 MiB。JSON 响应执行 JSON 序列化，纯文本响应转为字符串。服务设置 `X-Content-Type-Options: nosniff`、`Content-Security-Policy: sandbox; default-src 'none'` 和 `Cache-Control: no-store`。
- `Set-Cookie`、`Location` 等白名单之外的响应头触发执行失败，不会发送给浏览器。

### 17.2 存储、询盘和日志

`ctx.store` 需要 `store` 权限，提供 `get`、`set`、`delete`。数据库 `plugin_store` 按网站、插件和来源隔离：公开范围使用 `public`，预览范围使用 `preview` 并继续按 `draftId` 隔离。每个范围最多 1,000 个键、1 MiB JSONB 内容，键名长度为 1 至 200 个字符，单个 JSON 值上限为 64,000 字节。写入事务检查容量，替换已有键时扣除旧值，键数达到上限后仍允许更新已有键；`get` 对不存在的键返回 `null`。

`ctx.inquiries.create` 需要 `inquiries` 权限，复用正式询盘校验与 `eventId` 幂等规则。网站、草稿和来源由入口决定，预览询盘固定为 `source: "preview"`，不会创建邮件或营销转化任务。

`ctx.fetch` 只访问声明的域名，不自动跟随重定向；单次外部请求限制为 4.5 秒，响应正文上限为 1 MiB。每次插件调用新建 isolate，执行上限为 5 秒。日志按网站、插件、来源及草稿记录，隐藏当前插件密钥，每次调用最多 100 条。

### 17.3 错误

- `400 VALIDATION_FAILED`：路由参数、正文格式或请求大小无效。
- `403 FORBIDDEN`：预览 capability、会话或成员权限失效。
- `404 NOT_FOUND`：网站没有有效发布记录，或者插件未知、禁用、没有 API 声明、未确认服务器权限。
- `502 PLUGIN_API_FAILED`：插件执行失败、超时、访问未声明域名，或者返回结果超过状态、响应头、正文或存储限制。

错误响应使用通用 `{error,code}` 结构，错误文字中的当前插件密钥会被隐藏。插件完整包格式与权限规则见 [插件规范](../plugins.md)。
