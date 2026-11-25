# 数据存储

PostgreSQL 保存账号、业务关系、凭据和查询索引，Git 保存网站可编辑内容及版本历史。站点知识库以 Wiki 文件为权威，PostgreSQL 仅保存列表、过滤与 Job 快照用的投影。

## 1. sandbox 目录

| 路径 | 内容 |
| --- | --- |
| `source/site-settings.json` | 常规设置、语言、搜索引擎开关 |
| `source/publish-config.json` | OLPS 托管地址、公开 API 地址、`siteId`、已启用连接器的公开 ID 与转化设置、IndexNow 密钥；由 API 在构建前写入 |
| `source/appearance.json` | 当前主题、`themeSettings`、`menus` |
| `source/plugins.json` | 已安装插件的启用状态与普通设置 |
| `source/pages/<pageId>/` | 页面共用文件 `page.json` 与各语言内容文件 |
| `source/collections/<collectionId>.json` | 内容类型定义 |
| `source/collections/<collectionId>/` | 总列表页、分组、条目 |
| `source/media/<mediaId>.json` | 媒体元数据 |
| `source/i18n/<locale>.json` | 主题与插件固定文字的翻译 |
| `source/redirects.json` | 地址修改后的旧地址 |
| `assets/uploads/` | 媒体原文件 |
| `themes/<themeId>/` | 已安装主题包 |
| `plugins/<pluginId>/` | 已安装插件包 |
| `tools/site-verify.mjs` | 校验程序 |
| `olps.manifest.json` | `verifyCommand` |
| `public/` | 构建产物 |
| `server-config/` | nginx、Apache、IIS、Netlify 的服务器配置 |

`.olps-cache/` 保存图片处理结果，写入 `.gitignore`。文件格式见 [page-model.md](page-model.md)、[themes.md](themes.md)、[plugins.md](plugins.md)、[localization.md](localization.md)、[static-output.md](static-output.md)。

## 2. PostgreSQL

| 数据 | 表 |
| --- | --- |
| 用户、密码摘要、会话摘要与过期时间 | `users`、`sessions` |
| 网站与草稿的用户所有权 | `site_owners`、`draft_owners` |
| 网站标识、`unpublished` / `published` 状态、远端地址与发布 commit | `sites` |
| sandbox 标识、必填 `site_id`、同步状态与版本信息 | `site_drafts` |
| 内容查询索引 | `pages`（含 `role`）、`collection_groups`、`collection_items`：每行是一个对象的一种语言版本，按 `draft_id`、对象 ID 与 `locale` 共同标识；`media` 按 `draft_id` 与 `mediaId` 标识 |
| 已发布内容查询 | `site_published_routes`，每行是一个已发布对象的一种语言版本，对应网站的 `publishedCommitId` |
| 每个网站独立的知识库与资料投影 | `knowledge_bases`（`site_id` 唯一）、`knowledge_documents`、`knowledge_assets`、`knowledge_imports`（字段见下节） |
| AI Job 与进度事件 | `jobs`、`job_events` |
| 询盘与邮件任务 | `inquiries`（含 `attribution`、`locale`）、`inquiry_email_outbox` |
| 报告与站内事件 | `reports`、`analytics_events` |
| 营销平台连接与选定账户 | `site_integrations`、`integration_credentials` |
| 服务器端转化发送记录 | `conversion_deliveries` |
| 投放与分析数据 | `marketing_metrics` |
| 插件 `secret` 设置与插件存储 | `plugin_secrets`、`plugin_store` |
| 发布目标与上传记录 | `deploy_targets`、`deploy_target_files` |
| 发布记录 | `publish_records` |
| 草稿预览访问 | `draft_preview_capabilities` |

凭据（营销平台令牌、插件 `secret` 设置、发布目标密码与密钥）用 AES-256-GCM 加密保存，密钥来自环境变量 `CREDENTIALS_ENCRYPTION_KEY`。缺少该变量时 API 启动失败。

### 2.1 知识库 Wiki 与投影

权威文件位于知识库进程的 `KNOWLEDGE_ROOT/<siteId>/`（默认 `.intermediate/knowledge-data/<siteId>/`），目录布局见 [design/knowledge-service.md](design/knowledge-service.md) §2.1。导入原件在 `raw/sources/`，编译页在 `wiki/`，任务状态与指纹在 `.olps-knowledge/`。

PostgreSQL 投影由 `@olps/knowledge` 在导入完成、手工写页、素材角色修正或 `POST .../projection/rebuild` 后写入：

| 表 | 作用 |
| --- | --- |
| `knowledge_bases` | 每个网站一条；`site_id` 唯一 |
| `knowledge_documents` | 文档投影：`title`、`content`、`source_document_id`、`updated_at`、`source_path`、`source_fingerprint`、`import_id`、`kind`（`manual` \| `imported_text` \| `wiki_page`）、`wiki_path`、`asset_refs`（jsonb，关联 `assetId` 列表） |
| `knowledge_assets` | 素材投影：`source_path`、`fingerprint`、`mime_type`、`byte_size`、宽高、`role` / `role_confidence` / `role_reason`、`caption`、`storage_key`、`promoted_media`（`{ [draftId]: mediaId }`）、`import_id`、时间戳 |
| `knowledge_imports` | 导入任务索引：`site_id`、`user_id`、`draft_id`、`source_name`、`status`、`stats`、`error`、时间戳；进度权威也可读 `.olps-knowledge/imports/<importId>/status.json` |

只改投影而不改 Wiki / 资产元数据视为无效；再次重建会按文件覆盖投影行。管理 API 的知识库读接口读投影；写接口经 knowledge 服务写入文件后再投影。设计细则见 [design/knowledge-service.md](design/knowledge-service.md) §6。

## 3. 规则

同一内容在不同草稿中保留相同 ID，每份草稿分别保存索引。Pull、Push 和每次编辑之后，管理 API 根据 sandbox 文件重建索引，包括删除。

源码中的内容是编辑与构建的依据。数据库索引用于查询和权限管理，不能代替 Git 中的已发布版本。

新建网站时，在一个数据库事务内创建 `sites`、网站成员、第一份草稿、草稿成员和知识库；随后初始化 sandbox，并由管理 API 调用 knowledge 服务确保对应 `siteId` 的项目目录存在。网站初始状态为 `unpublished`，首次发布成功后改为 `published`。草稿的 `site_id` 始终必填。

网站成员可以使用该网站的知识库。资料跨网站使用时复制必要的 raw/wiki 子树到目标站点并重新投影，生成新的 `document_id`（及需要时的新 `asset_id`），复制后的资料互不自动同步。

同步操作保存待执行动作、远端标识和错误信息。进程重新启动后，系统根据持久化状态继续处理，并检查远端已经发布的版本。失败操作不得重复创建网站。

多个用户移除所有者时，数据库事务必须保证至少保留一名所有者。同一草稿的编辑、同步和发布操作需要互斥，操作开始时检查当前权限。

## 4. 迁移已有数据

迁移已有数据时，网站内容与配置进入对应草稿的 Git 仓库，所有者由显式的账号映射确定。尚未在独立远端发布的内容保留为草稿。询盘、邮件任务、报告、事件和集成配置保留原记录标识及关联，通过 `draft_id` 归属未发布草稿；首次发布后关联实际网站。用户可以在草稿中访问历史记录。

迁移在修改表结构前检查完整的所有权映射、账号和数据引用。数据库变更在同一事务内完成，并验证 sandbox 中的源码和 Git 版本。失败时保留原有数据库，重试使用稳定的迁移标识。迁移测试覆盖所有业务表的字段、主键、关联与重复执行。

### 4.1 页面转换为区块模型

已有 sandbox 里的 `source/pages/<pageId>.json` 按以下规则转换。完整文件格式见 [design/sandbox-formats.md](design/sandbox-formats.md)：

1. 每个旧页面转换为 `source/pages/<pageId>/page.json` 与默认语言的 `<locale>.json`。`pageId` 与 `status` 写入共用文件；`slug`、`title`、`seo` 写入语言文件。
2. 旧页面的 `body.html` 放进一个 `core/html` 区块，作为这个页面唯一的区块。
3. 旧页面的 `slug` 等于某个必备页面的默认 `slug` 时，这个页面获得对应的 `role`；没有对应页面的必备页面按默认模板新建，状态为 `draft`。
4. 写入 `source/appearance.json`（主题 `starter`）、`source/plugins.json`（内置插件）、三个预设内容类型（没有分组和条目）、`themes/starter/`、`plugins/` 下的内置插件、`tools/site-verify.mjs`，`olps.manifest.json` 改为只有 `verifyCommand`。
5. 旧页面引用的 `assets/` 文件登记为媒体，生成 `source/media/<mediaId>.json`，文件移到 `assets/uploads/`；`core/html` 区块里的地址同步替换。

转换在一个 commit 里完成。转换后执行一次完整构建和 `site-verify`，失败时迁移终止，sandbox 保持转换前的 commit。
