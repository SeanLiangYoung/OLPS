# 领域模型规约

本文件定义跨 `packages/domain`、管理 API、构建程序和管理界面共用的类型与强制规则。文件格式以 [sandbox-formats.md](sandbox-formats.md) 为准，接口格式以 [api-conventions.md](api-conventions.md) 为准。

## 1. 通用类型

```ts
type EntityId = string
type IsoDateTime = string
type LocaleCode = string
type SchemaVersion = 1
type ContentStatus = 'draft' | 'published'

type SeoFields = {
  title: string
  description: string
  ogImage: MediaRef | null
}

type MediaRef = {
  mediaId: EntityId
}
```

- 所有实体 ID 由 `crypto.randomUUID()` 生成，在网站的全部草稿与语言版本之间保持不变。
- 时间使用 UTC 的 ISO 8601 格式，写入时必须包含 `Z`。
- `LocaleCode` 由 `Intl.getCanonicalLocales` 规范化后保存。
- sandbox 中的受管 JSON 文件类型增加 `schemaVersion: SchemaVersion`。
- 数据文件里不保存数据库自增编号、sandbox 路径和 Git commit。
- `createdAt` 只在创建时写入；内容变化时更新 `updatedAt`。

## 2. 网站与草稿

```ts
type SiteStatus = 'unpublished' | 'published'

type SiteRecord = {
  siteId: EntityId
  name: string
  status: SiteStatus
  remoteSiteId: string | null
  publishedCommitId: string | null
  publicUrl: string | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

type DraftInitStatus = 'initializing' | 'ready' | 'failed'
type DraftStatus = 'active' | 'syncing' | 'conflict' | 'error' | 'archived'
type DraftSyncStatus =
  | 'clean'
  | 'dirty'
  | 'merge_conflict'
  | 'awaiting_user'
  | 'validation_failed'

type DraftRecord = {
  draftId: EntityId
  siteId: EntityId
  name: string
  initStatus: DraftInitStatus
  status: DraftStatus
  syncStatus: DraftSyncStatus
  sandboxId: string
  baseCommitId: string | null
  headCommitId: string | null
  pendingOperation: 'pull' | 'push' | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
```

- 新建网站时立即创建 `sites` 记录，初始 `status` 为 `unpublished`，同时创建第一份草稿。
- `site_drafts.site_id` 必填。任何草稿都必须属于一个网站。
- 首次发布成功后，`sites.status` 改为 `published`，并写入 `remoteSiteId`、`publishedCommitId` 与 `publicUrl`。
- 网站成员决定网站级资源的权限。草稿成员决定草稿内容的编辑权限；网站至少保留一名成员。

## 3. 网站设置

```ts
type LocaleDefinition = {
  code: LocaleCode
  dir: 'ltr' | 'rtl'
}

type CompanyInfo = {
  name: string
  address: string
  phone: string
  email: string
}

type SocialLink = {
  platform: string
  url: string
}

type SiteSettings = {
  siteName: string
  siteUrl: string
  company: CompanyInfo
  iconMediaId: EntityId | null
  socialLinks: SocialLink[]
  locales: LocaleDefinition[]
  defaultLocale: LocaleCode
  search: {
    allowIndexing: boolean
    allowAiSearch: boolean
    allowAiTraining: boolean
  }
}
```

- 至少启用一种语言，`defaultLocale` 必须出现在 `locales`。
- `siteUrl` 为空时，构建使用 OLPS 托管地址生成绝对地址。
- `iconMediaId` 必须引用当前草稿中存在的媒体。
- `socialLinks[].url` 必须是 `https:` 地址。

## 4. 内容引用与链接

```ts
type ContentRef =
  | { ref: 'page'; id: EntityId }
  | { ref: 'collection'; id: EntityId }
  | { ref: 'group'; id: EntityId }
  | { ref: 'item'; id: EntityId }

type InternalLink = {
  kind: 'internal'
  target: ContentRef
}

type ExternalLink = {
  kind: 'external'
  url: string
  newWindow: boolean
}

type LinkValue = InternalLink | ExternalLink
```

- `ref: 'collection'` 表示内容类型的总列表页。
- `publish` 模式只允许引用状态为 `published` 且具有当前语言文件的对象。
- `preview` 与 `canvas` 模式允许引用当前草稿里状态为 `draft` 的对象；缺少目标语言时链接到该语言首页。
- 外部地址只允许 `https:`、`mailto:` 和 `tel:`。

## 5. 页面

```ts
type PageRole =
  | 'home'
  | 'about'
  | 'contact'
  | 'privacy'
  | 'terms'
  | 'cookies'
  | 'thank-you'
  | 'not-found'

type PageMeta = {
  pageId: EntityId
  role: PageRole | null
  template: string
  status: ContentStatus
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

type PageLocaleFile = {
  locale: LocaleCode
  slug: string
  title: string
  summary: string
  cover: MediaRef | null
  seo: SeoFields
  blocks: BlockNode[]
  sourceHash: string | null
  updatedAt: IsoDateTime
}
```

- 每个网站的每种 `PageRole` 只能有一个页面承担。
- `home` 和 `not-found` 的 `slug` 保存为空字符串。
- 职责转移必须在一次草稿写入锁中完成：新页面取得 `role`，原页面的 `role` 改为 `null`。
- 必备页面不可删除。发布构建要求八个必备页面都存在并含有至少一个区块。
- 新建网站时由 `starter` 主题为必备页面写入默认区块，因此网站创建完成后即可预览。

## 6. 内容类型

```ts
type FieldType =
  | 'text'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'select'
  | 'date'
  | 'media'
  | 'mediaList'
  | 'link'
  | 'table'
  | 'reference'

type CollectionLevel = {
  levelId: EntityId
  name: string
}

type FieldDefinition = {
  key: string
  type: FieldType
  label: string
  translatable: boolean
  required: boolean
  options?: Array<{ value: string; label: string }>
  columns?: Array<{ key: string; label: string; type: 'text' | 'number' }>
  referenceCollectionId?: EntityId
}

type CollectionDefinition = {
  collectionId: EntityId
  name: string
  labels: Record<LocaleCode, string>
  prefix: string
  status: ContentStatus
  levels: CollectionLevel[]
  fields: FieldDefinition[]
  structuredData: 'Product' | 'NewsArticle' | 'Service' | null
  feed: boolean
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
```

- `FieldDefinition.key` 在一个内容类型内唯一，符合 `^[a-z][a-zA-Z0-9_]*$`。
- `select` 必须提供非空 `options`；`table` 必须提供非空 `columns`；`reference` 必须提供 `referenceCollectionId`。
- 内容类型已有分组或条目时，减少 `levels`、删除字段、改变字段 `type` 或 `translatable` 会被拒绝，响应列出受影响对象。
- 增加可选字段、修改名称、标签和结构化数据类型可以直接保存。
- 内容类型的 `status` 决定总列表页、分组和条目是否可以进入发布构建。内容类型为 `draft` 时，其下对象均不公开。

### 6.1 字段值

```ts
type FieldValue =
  | string
  | number
  | boolean
  | MediaRef
  | MediaRef[]
  | LinkValue
  | Array<Record<string, string | number>>
  | ContentRef
  | RichtextDocument
  | null

type FieldValues = Record<string, FieldValue>
```

- `date` 使用 `YYYY-MM-DD`。
- `richtext` 使用 TipTap JSON 文档对象，不能保存 HTML 字符串。
- `reference` 的 `ref` 必须是 `item`，目标条目必须属于 `referenceCollectionId`。
- 未定义字段和值类型不匹配时拒绝保存。

## 7. 总列表页、分组与条目

```ts
type CollectionIndexLocaleFile = {
  locale: LocaleCode
  title: string
  summary: string
  cover: MediaRef | null
  seo: SeoFields
  blocks: BlockNode[]
  sourceHash: string | null
  updatedAt: IsoDateTime
}

type GroupMeta = {
  groupId: EntityId
  parentGroupId: EntityId | null
  levelId: EntityId
  order: number
  status: ContentStatus
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

type GroupLocaleFile = {
  locale: LocaleCode
  slug: string
  title: string
  summary: string
  cover: MediaRef | null
  seo: SeoFields
  blocks: BlockNode[]
  sourceHash: string | null
  updatedAt: IsoDateTime
}

type ItemMeta = {
  itemId: EntityId
  primaryGroupId: EntityId | null
  groupIds: EntityId[]
  order: number
  publishedAt: IsoDateTime | null
  status: ContentStatus
  fields: FieldValues
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

type ItemLocaleFile = {
  locale: LocaleCode
  slug: string
  title: string
  summary: string
  cover: MediaRef | null
  seo: SeoFields
  blocks: BlockNode[]
  fields: FieldValues
  sourceHash: string | null
  updatedAt: IsoDateTime
}
```

- `CollectionIndexLocaleFile` 的公开状态取自 `CollectionDefinition.status`。
- 根分组的 `parentGroupId` 为 `null`。分组深度必须和 `levelId` 在 `levels` 中的位置一致。
- 有分组层级时，条目只能加入最后一层分组，`primaryGroupId` 必须包含在 `groupIds`。
- 无分组层级时，`primaryGroupId` 为 `null` 且 `groupIds` 为空。
- 条目可以出现在 `groupIds` 的全部分组列表中；面包屑、上一篇和下一篇使用 `primaryGroupId`。
- `ItemMeta.fields` 只保存 `translatable: false` 的字段；`ItemLocaleFile.fields` 只保存 `translatable: true` 的字段。

## 8. 区块

```ts
type BlockNode = {
  id: EntityId
  type: string
  props: Record<string, unknown>
  children: BlockNode[]
}

type BlockSource = 'core' | 'theme' | 'plugin'

type BlockFieldType =
  | 'text'
  | 'richtext'
  | 'media'
  | 'mediaList'
  | 'link'
  | 'select'
  | 'color'
  | 'number'
  | 'boolean'
  | 'list'

type BlockFieldDefinition = {
  key: string
  type: BlockFieldType
  label: string
  required: boolean
  translatable: boolean
  default?: unknown
  options?: Array<{ value: string; label: string }>
  itemFields?: BlockFieldDefinition[]
}

type BlockDefinition = {
  type: string
  source: BlockSource
  name: string
  description: string
  category: string
  fields: BlockFieldDefinition[]
  accepts: string[]
  preview: Record<string, unknown>
}
```

- `type` 只能使用 `core/<name>`、`theme/<name>` 或 `plugin/<pluginId>/<name>`。
- `id` 在单个内容对象的区块树内唯一。
- `select` 必须提供 `options`，`list` 必须提供 `itemFields`。
- 插件设置可以在 `BlockFieldType` 基础上增加 `secret`；主题设置不能使用 `secret`。
- `children` 只有在定义的 `accepts` 允许对应类型时才可使用。
- `props` 保存前和构建前都按区块定义生成的 JSON Schema 校验。
- `core/html` 可以保存 HTML；其他富文本字段必须保存 TipTap JSON。

## 9. 媒体

```ts
type LocalizedMediaText = Record<LocaleCode, string>

type MediaMeta = {
  mediaId: EntityId
  path: string
  mimeType: string
  size: number
  width: number | null
  height: number | null
  title: LocalizedMediaText
  alt: LocalizedMediaText
  caption: LocalizedMediaText
  uploadedBy: EntityId
  uploadedAt: IsoDateTime
  updatedAt: IsoDateTime
}
```

- `path` 必须位于 `assets/uploads/`，使用 `/` 分隔。
- 图片必须保存 `width` 与 `height`；文档和视频为 `null`。
- 替换文件时保持 `mediaId`，并更新文件信息与 `updatedAt`。
- 删除被内容、设置、菜单、主题设置或插件普通设置引用的媒体时返回冲突错误和全部引用位置。

## 10. 知识库

```ts
type KnowledgeBase = {
  knowledgeBaseId: EntityId
  siteId: EntityId
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

type KnowledgeDocument = {
  documentId: EntityId
  knowledgeBaseId: EntityId
  title: string
  content: string
  sourceDocumentId: EntityId | null
  createdBy: EntityId
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
```

- 每个网站只有一个 `KnowledgeBase`，数据库对 `siteId` 建立唯一约束。
- 网站成员可以读取和修改该网站的知识库。
- 跨网站共享资料通过复制完成。目标网站生成新的 `documentId`，`sourceDocumentId` 记录来源；复制后两份资料互不自动同步。
- 删除来源资料不影响已经复制到其他网站的资料。

## 11. 翻译哈希

`sourceHash` 使用 SHA-256。计算步骤：

1. 从默认语言文件移除 `locale`、`slug`、`sourceHash` 和 `updatedAt`。
2. 保留标题、摘要、搜索引擎信息、区块树和可翻译字段。
3. 使用 RFC 8785 JSON Canonicalization Scheme 生成字节序列。
4. 计算小写十六进制 SHA-256。

默认语言文件的 `sourceHash` 固定为 `null`。非默认语言文件保存最近一次翻译所依据的默认语言哈希。

## 12. 发布状态

- `draft` 对象存在于草稿和预览中，不进入公开构建。
- `published` 对象进入下一次公开构建。
- 后台的「已发布但有修改未发布」是展示状态，不写入内容文件。它由当前对象文件摘要与网站 `publishedCommitId` 中同一对象的文件摘要比较得出。
- 对象任一语言文件、共用文件、引用媒体或相关设置变化，都视为该对象有未发布修改。
