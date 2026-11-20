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

- 发布、Pull、AI Job、资料复制和发布目标重试必须带 `Idempotency-Key`。
- 同一用户、同一路由、同一键在 24 小时内返回同一操作记录。
- 同一键的请求体不同则返回 409 `REVISION_CONFLICT`。
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
  "returnPath": "/drafts/af999cf1-44d5-4931-8515-6c17f584bf68/pages/17fa1c4f-cf9e-44d4-aa77-5e8366a55097"
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

### 10.2 预览询盘

`POST /api/preview-access/:token/inquiries`

- 表单提交保存到当前 `draftId`，`siteId` 使用草稿所属网站。
- 询盘标记 `source: "preview"`，不会发送通知、营销转化或第三方事件。
- 后台询盘列表默认排除预览询盘，可以通过筛选器显示。
- 请求仍执行字段、隐私同意和频率限制校验。

## 11. 知识库

每个网站只有一个知识库：

```text
GET                  /api/sites/:siteId/knowledge-base
GET/POST             /api/sites/:siteId/knowledge-base/documents
GET/PUT/DELETE       /api/sites/:siteId/knowledge-base/documents/:documentId
POST                 /api/sites/:siteId/knowledge-base/documents/:documentId/copy
```

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

Job 请求必须含 `draftId`，服务端从草稿取得 `siteId` 和该网站知识库。请求中的 `knowledgeDocumentIds` 可选；未提供时不读取知识库。

SSE：

```text
GET /api/jobs/:jobId/events
Last-Event-ID: <eventId>
```

事件格式由 [state-models.md](state-models.md) 定义。

## 13. 发布

`POST /api/drafts/:draftId/push`

- 请求必须带 `Idempotency-Key`。
- API 先对当前草稿执行完整构建和校验，再进入现有 Git Push 流程。
- 首次成功发布把网站状态改为 `published`。
- 响应返回操作记录；长操作进度通过 SSE 或发布对话框轮询取得。

发布目标上传只使用同一次发布生成的 `public/` 与 `server-config/`，不能再次读取正在变化的草稿。

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
