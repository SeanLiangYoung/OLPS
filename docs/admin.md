# Admin：网站管理后台

后台的信息结构参考 WordPress：左侧菜单分模块，每个模块有固定入口。运营在后台完成建站、编辑、发布和营销工作，不需要了解技术细节。后台界面使用中文。

## 1. 简洁原则

后台不显示 sandbox 编号、commit 编号、base/head 版本、Job 编号、文件路径和英文状态值。时间显示为本地格式，例如「2026年11月19日 15:20」。

| 界面说法 | 对应的系统概念 |
|----------|----------------|
| 我的网站 | 已发布网站与草稿列表 |
| 发布网站 | Push |
| 同步最新内容 | Pull |
| 固定链接 | `slug`，由标题自动生成 |
| 搜索结果标题 / 搜索结果摘要 | `seo.title` / `seo.description`，默认自动填写，平时折叠 |
| 正在生成… | Job 进度 |
| 需要你决定 | 同步冲突中 Agent 提出的问题 |

页面、分组、条目只显示三种状态：草稿、已发布、已发布但有修改未发布。

源码只出现在两个位置：编辑器里的「自定义 HTML」区块，以及「工具 → 网站文件」。

## 2. 外框

- **登录**：`/login`，本系统账号与密码。
- **我的网站**：`/sites`，列出用户拥有的未发布与已发布网站及其草稿，可以新建网站（同时创建第一份草稿）、给已有网站新建草稿、管理成员。必须选定一个草稿才能进入其他模块。
- **顶栏**（从左到右）：
  - 网站名称可点，文案「查看网站」，打开当前草稿的整站预览（从首页进入）
  - 草稿名称
  - 「发布网站」按钮，旁边显示「有未发布的修改」
  - 其他成员发布了新内容时（网站当前发布版本比草稿的同步版本新），显示「其他成员发布了新内容」和「同步最新内容」按钮
  - 「切换网站」：进入 `/sites`，重新选择网站或草稿
  - 用户菜单：显示当前用户名，菜单内只有「退出」
- **草稿预览页顶部 admin bar**（仅运营已登录的预览会话出现，公开访客页没有）：
  - 左侧「返回后台」，回到进入预览前所在的后台页面
  - 右侧显示当前用户

## 3. 左侧菜单

| 菜单 | 子菜单 | 路由 |
|------|--------|------|
| 仪表盘 | — | `/dashboard` |
| 页面 | 全部页面、新建页面 | `/pages` |
| 每个内容类型各占一项，例如「新闻」「产品」「解决方案」 | 全部条目、分组、列表页 | `/collections/:collectionId` |
| 媒体 | 媒体库、上传 | `/media` |
| 询盘 | — | `/inquiries` |
| 外观 | 主题、自定义、菜单、文字翻译 | `/appearance/themes`、`/appearance/customize`、`/appearance/menus`、`/appearance/texts` |
| 插件 | 已安装插件、上传插件、设置 | `/plugins` |
| 营销集成 | — | `/integrations` |
| 工具 | AI 建站、报告、网站文件、发布记录 | `/generate`、`/reports`、`/publish` |
| 设置 | 常规、搜索引擎、内容类型、发布目标、成员 | `/settings/general`、`/settings/search`、`/settings/content-types`、`/settings/targets`、`/settings/members` |

编辑器路由使用 `/content/:ref/:id`，`ref` 为 `page`、`collection`、`group` 或 `item`。编辑器使用当前选定的草稿读取内容，并通过查询参数 `?locale=<语言>` 选择正在编辑的语言。

## 4. 模块

### 4.1 仪表盘

- 最近 30 天的原生页面浏览、公开询盘及已标记有效数量。
- Google 网站统计的每日活跃用户累计、会话、页面浏览与关键事件；Google 广告和 Meta 的平台转化与花费；Google 搜索表现的点击与展示。未同步数据显示状态，平台与币种分别显示。
- 广告来源询盘成本使用相同平台、币种、已同步日期的花费与同期来源询盘计算；币种不明或当天存在多个币种时不计算。平台归因转化与网站来源询盘分别统计。
- 平台日报使用平台返回日期，询盘按世界标准时间对应日期计算；平台账户时区会影响日期边界。
- 未处理的询盘
- 未发布的修改
- 各语言的翻译状态汇总
- 最近一次全站 SEO 体检发现的问题数量
- 快捷入口：新建页面、AI 建站、发布网站

### 4.2 页面

- 必备页面固定显示在列表顶部，标题旁标注职责，例如「首页」「隐私政策页面」。
- 列：标题、状态、各语言翻译状态、更新时间。
- 操作：编辑、预览、删除。必备页面没有删除操作。
- 新建页面时选择模板，填写标题后打开编辑器，固定链接由标题自动生成。

### 4.3 内容类型

- 左侧是分组树，可以拖拽调整层级和顺序；右侧是当前分组下的条目列表。
- 条目可以拖到另一个分组；在条目设置里可以加入多个分组，并选择主分组。
- 列表页（总列表页）、分组、条目都在编辑器里编辑。
- 列：标题、状态、发布时间、各语言翻译状态、更新时间。

### 4.4 编辑器

页面、列表页、分组、条目共用一个编辑器。

- **中间画布**：iframe 显示真实的主题效果，由 `packages/render` 在浏览器里实时渲染。点选区块会高亮；文字直接在画布上修改，富文本用 `@tiptap/vue-3`。
- **左侧**：区块库（核心区块、主题区块、插件区块，按分类显示），以及大纲。大纲用 `vuedraggable` 拖拽排序和调整层级。
- **右侧**：
  - 选中区块时显示区块属性表单，表单由区块字段定义自动生成；图片字段打开媒体库选择器。
  - 未选中区块时显示设置：固定链接、模板、状态、职责（必备页面）、摘要与封面、内容类型字段、所属分组与主分组、搜索结果标题与摘要（折叠）。
- **顶部**：
  - 语言切换和翻译状态；切换到非默认语言时，侧边显示默认语言的内容作为参照
  - 电脑、平板、手机宽度切换
  - 撤销、重做
  - 保存，以及保存状态提示；修改未保存时离开页面会提示
  - 预览（打开完整的预览页面）
  - SEO 检查清单
- **AI**：
  - 「用 AI 修改」：输入一句修改指令，作用于整个页面。
  - 选中区块后「AI 重写这一块」：只修改这个区块。
  - 生成过程中，区块在画布上逐个出现。

SEO 检查清单用日常说法提示以下问题：搜索结果标题和摘要的长度、主标题数量、标题层级、图片替代文字、和其他页面的标题重复、内容过少。

编辑器图片与主题资源通过短期授权读取。主画布和自定义字段会在期限结束前更新授权；图片读取失败时重新取得授权并加载。服务端使用 `EDITOR_RESOURCE_TTL_SECONDS` 配置期限，默认 900 秒。CSS 内的导入、图片和字体地址继续携带同一资源授权，并执行受管目录边界检查。

### 4.5 媒体库

- 缩略图网格和列表两种视图，支持拖拽上传、按类型和月份筛选、搜索。
- 点开文件显示详情：预览、文件信息、各语言的标题、替代文字、说明，以及「使用位置」（引用它的页面和条目）。
- 可以替换文件，替换后所有引用自动使用新文件。
- 删除被引用的文件时拒绝，并列出使用位置。

### 4.6 询盘

- 列：时间、联系人、来源页面、语言、来源平台、广告系列、关键词、状态。
- 状态：新询盘、有效、无效、已处理。标记为「有效」时触发离线转化上传，见 [integrations.md](integrations.md)。
- 详情显示表单内容、广告来源信息、转化发送记录（失败时可以重新发送）、邮件通知记录（可以重新发送）。

### 4.7 外观

见 [themes.md](themes.md) 第 7 节。

### 4.8 插件

见 [plugins.md](plugins.md) 第 3 节。

### 4.9 营销集成

见 [integrations.md](integrations.md)。

### 4.10 工具

- **AI 建站**：填写需求、选择当前网站知识库中的资料（可选）后，AI 提出整站结构，以树形图显示。树形图上可以增加、删除、修改、拖动节点；确认后批量生成，生成进度显示在每个节点上，点开节点进入编辑器。见 [ai-generation.md](ai-generation.md)。
- **报告**：检查当前编辑版本中页面、内容列表、分组和条目的全部语言，使用与编辑器相同的 SEO 检查规则，并检查构建条件、站内链接和标题位置。按内容显示修改建议，并提供对应编辑入口。每次检查保存结果，可选择检查记录查看历史报告。
- **网站文件**：只读查看网站当前发布版本里的 `robots.txt`、`sitemap.xml`、`llms.txt`、`feed.xml`、`manifest.webmanifest` 等文件。
- **发布记录**：每次发布的时间、操作人、发布类型、各发布目标的结果；可以下载 zip，可以对失败的目标重新上传。

### 4.11 设置

- **常规**：网站名称、网站地址、公司信息（名称、地址、电话、邮箱）、网站图标、社交账号链接、语言（见 [localization.md](localization.md)）。
- **搜索引擎**：允许搜索引擎收录、允许 AI 搜索引用、允许 AI 训练使用，见 [platform-defaults.md](platform-defaults.md)。
- **内容类型**：新建内容类型，修改名称、地址前缀、层级、字段。
- **发布目标**：添加、测试、启用、停用发布目标，见 [static-output.md](static-output.md)。
- **成员**：网站和草稿的所有者管理。

## 5. 发布网站

1. 点击顶栏的「发布网站」，弹窗显示本次修改的数量（页面、条目、媒体、外观、插件、设置），以及构建检查的结果。
2. 检查通过后确认发布，弹窗显示进度：合并最新内容、构建、发布到 OLPS 托管、上传到各发布目标。
3. 完成后显示网站地址；某个发布目标失败时显示原因和「重新上传」按钮。
4. 同步过程中遇到需要用户决定的冲突时，弹窗显示 Agent 提出的问题和说明，用户填写决定后继续。

远端暂时不可用时，弹窗显示错误原文，可以在同一个弹窗里重试。草稿状态与重试规则见 [site-collaboration.md](site-collaboration.md) 和 [error-handling.md](error-handling.md)。

## 6. 业务数据的范围

每份草稿都带 `siteId`。询盘、知识库、营销集成和发布目标属于网站；内容编辑、报告和预览属于当前草稿：

| 数据 | 范围 | 主要 API |
|------|------|----------|
| 公开询盘、知识库、发布目标、发布记录 | 网站 | `/api/sites/:siteId/...` |
| 内容、营销设置、当前草稿预览 | 草稿 | `/api/drafts/:draftId/...` |
| SEO 报告 | 网站及选定草稿 | `/api/sites/:siteId/reports?draftId=:draftId` |
| 预览询盘 | 网站 + 来源草稿 | `/api/preview-access/:token/inquiries` |

报告的候选内容始终来自当前草稿，含未发布内容。切换草稿时清空已选对象。后台询盘列表默认排除 `source=preview` 的记录，可以通过筛选器显示。

## 7. API

返回字段使用 camelCase。编辑接口带 `draftId`，线上业务接口带 `siteId`。

### 账号、网站、草稿与同步

```
POST   /api/auth/register | /api/auth/login | /api/auth/logout
GET    /api/auth/me
GET    /api/sites
POST   /api/sites
GET    /api/sites/:siteId
GET    /api/drafts
POST   /api/drafts                    # 必须提供已有 siteId
GET/PUT /api/drafts/:draftId/settings
POST   /api/drafts/:draftId/locales
POST   /api/sites/:siteId/publish
POST   /api/sites/:siteId/drafts/:draftId/pull
POST   /api/sites/:siteId/drafts/:draftId/continue
GET    /api/sites/:siteId/drafts/:draftId/synchronization
GET/POST/DELETE /api/sites/:siteId/owners[/:userId]
GET/POST/DELETE /api/drafts/:draftId/owners[/:userId]
GET    /api/sites/:siteId/drafts
GET    /api/sites/:siteId/overview?draftId=:draftId&locale=:locale
```

### 内容

```
GET/POST              /api/drafts/:draftId/pages
GET/PUT/DELETE        /api/drafts/:draftId/pages/:pageId?locale=:locale
GET/PUT/DELETE        /api/drafts/:draftId/content/:ref/:id?locale=:locale
POST                  /api/drafts/:draftId/content/:ref
GET/POST              /api/drafts/:draftId/collections
GET/PUT/DELETE        /api/drafts/:draftId/collections/:collectionId?locale=:locale
GET/POST              /api/drafts/:draftId/collections/:collectionId/groups
GET/PUT/DELETE        /api/drafts/:draftId/collections/:collectionId/groups/:groupId?locale=:locale
GET/POST              /api/drafts/:draftId/collections/:collectionId/items
GET/PUT/DELETE        /api/drafts/:draftId/collections/:collectionId/items/:itemId?locale=:locale
POST                  /api/drafts/:draftId/collections/:collectionId/reorder
POST                  /api/drafts/:draftId/preview          # { target: { ref, id }, locale }
GET                   /api/drafts/:draftId/source?path=:relative&list=1
POST                  /api/drafts/:draftId/resource-access
GET                   /api/drafts/:draftId/resources/*?token=:token
```

### 媒体

```
GET/POST              /api/drafts/:draftId/media             # POST 为 multipart 上传
GET/PUT/DELETE        /api/drafts/:draftId/media/:mediaId
POST                  /api/drafts/:draftId/media/:mediaId/replace
GET                   /api/drafts/:draftId/media/:mediaId/file
GET                   /api/drafts/:draftId/media/:mediaId/usages
```

### 外观与插件

```
GET/POST              /api/drafts/:draftId/themes            # POST 为 zip 上传
POST                  /api/drafts/:draftId/themes/:themeId/activate
DELETE                /api/drafts/:draftId/themes/:themeId
GET                   /api/drafts/:draftId/themes/:themeId/files/*
GET/PUT               /api/drafts/:draftId/appearance
GET/PUT               /api/drafts/:draftId/i18n/:locale
GET/POST              /api/drafts/:draftId/plugins           # POST 为 zip 上传
PUT/DELETE            /api/drafts/:draftId/plugins/:pluginId
GET/PUT               /api/drafts/:draftId/plugins/:pluginId/settings
GET                   /api/drafts/:draftId/plugins/:pluginId/logs
```

### AI

```
POST   /api/jobs/:type
GET    /api/jobs/:jobId
GET    /api/jobs/:jobId/events          # SSE
GET    /api/sites/:siteId/knowledge-base
GET/POST /api/sites/:siteId/knowledge-base/documents
GET/PUT/DELETE /api/sites/:siteId/knowledge-base/documents/:documentId
POST   /api/sites/:siteId/knowledge-base/documents/:documentId/copy
```

### 业务

```
GET    /api/sites/:siteId/inquiries?source=public
PATCH  /api/sites/:siteId/inquiries/:inquiryId
POST   /api/sites/:siteId/inquiries/:inquiryId/deliveries/:taskId/retry
GET    /api/sites/:siteId/reports?draftId=:draftId  # 检查当前编辑版本并保存全站结果
GET    /api/sites/:siteId/reports/history          # 包含迁移报告的检查历史
GET    /api/sites/:siteId/reports/:reportId        # 检查摘要、内容清单和问题
GET    /api/drafts/:draftId/integrations
PUT    /api/drafts/:draftId/integrations/:connectorId
POST   /api/drafts/:draftId/integrations/oauth/:provider
GET    /api/integrations/oauth/:provider/callback
GET    /api/drafts/:draftId/integrations/:connectorId/accounts
DELETE /api/drafts/:draftId/integrations/:connectorId
POST   /api/drafts/:draftId/integrations/:connectorId/metrics/sync
GET    /api/sites/:siteId/marketing-metrics?draftId=:draftId
GET/POST /api/sites/:siteId/deploy-targets
DELETE /api/sites/:siteId/deploy-targets/:targetId
POST   /api/sites/:siteId/deploy-targets/:targetId/test
GET    /api/sites/:siteId/publish-records
GET    /api/sites/:siteId/publish-records/:recordId/download.zip
POST   /api/sites/:siteId/publish-records/:recordId/targets/:targetId/retry
POST   /api/sites/:siteId/publish-records/:recordId/notifications/:provider/retry
GET    /api/sites/:siteId/site-files[/*]
```

### 访客端

```
POST   /api/public/:siteId/inquiries
POST   /api/public/:siteId/events
ALL    /api/public/:siteId/plugins/:pluginId/*
GET    /preview-access/:token/*
```

页面、分组、条目由 `draftId` 与对象 ID 共同定位；同一网站的不同草稿共享对象 ID。线上发布只通过「发布网站」完成，没有单页发布接口。

请求响应、错误、并发修改、预览、知识库和发布规则见 [design/api-conventions.md](design/api-conventions.md)。
