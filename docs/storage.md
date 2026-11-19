# 数据存储

PostgreSQL 保存账号、业务关系、凭据和查询索引，Git 保存网站可编辑内容及版本历史。

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
| 已发布网站标识、远端地址与发布 commit | `sites` |
| sandbox 标识、同步状态与版本信息 | `site_drafts` |
| 内容查询索引 | `pages`（含 `role`）、`collection_groups`、`collection_items`：每行是一个对象的一种语言版本，按 `draft_id`、对象 ID 与 `locale` 共同标识；`media` 按 `draft_id` 与 `mediaId` 标识 |
| 已发布内容查询 | `site_published_routes`，每行是一个已发布对象的一种语言版本，对应网站的 `publishedCommitId` |
| 知识库 | `knowledge_bases`、`knowledge_base_grants`、`knowledge_documents` |
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

## 3. 规则

同一内容在不同草稿中保留相同 ID，每份草稿分别保存索引。Pull、Push 和每次编辑之后，管理 API 根据 sandbox 文件重建索引，包括删除。

源码中的内容是编辑与构建的依据。数据库索引用于查询和权限管理，不能代替 Git 中的已发布版本。

同步操作保存待执行动作、远端标识和错误信息。进程重新启动后，系统根据持久化状态继续处理，并检查远端已经发布的版本。失败操作不得重复创建网站。

多个用户移除所有者时，数据库事务必须保证至少保留一名所有者。同一草稿的编辑、同步和发布操作需要互斥，操作开始时检查当前权限。

## 4. 迁移已有数据

迁移已有数据时，网站内容与配置进入对应草稿的 Git 仓库，所有者由显式的账号映射确定。尚未在独立远端发布的内容保留为草稿。询盘、邮件任务、报告、事件和集成配置保留原记录标识及关联，通过 `draft_id` 归属未发布草稿；首次发布后关联实际网站。用户可以在草稿中访问历史记录。

迁移在修改表结构前检查完整的所有权映射、账号和数据引用。数据库变更在同一事务内完成，并验证 sandbox 中的源码和 Git 版本。失败时保留原有数据库，重试使用稳定的迁移标识。迁移测试覆盖所有业务表的字段、主键、关联与重复执行。

### 4.1 页面转换为区块模型

已有 sandbox 里的 `source/pages/<pageId>.json` 按以下规则转换：

1. 每个旧页面转换为 `source/pages/<pageId>/page.json` 与默认语言的 `<locale>.json`，`pageId`、`slug`、`title`、`seo`、`status` 保持不变。
2. 旧页面的 `body.html` 放进一个 `core/html` 区块，作为这个页面唯一的区块。
3. 旧页面的 `slug` 等于某个必备页面的默认 `slug` 时，这个页面获得对应的 `role`；没有对应页面的必备页面按默认模板新建，状态为 `draft`。
4. 写入 `source/appearance.json`（主题 `starter`）、`source/plugins.json`（内置插件）、三个预设内容类型（没有分组和条目）、`themes/starter/`、`plugins/` 下的内置插件、`tools/site-verify.mjs`，`olps.manifest.json` 改为只有 `verifyCommand`。
5. 旧页面引用的 `assets/` 文件登记为媒体，生成 `source/media/<mediaId>.json`，文件移到 `assets/uploads/`；`core/html` 区块里的地址同步替换。

转换在一个 commit 里完成。转换后执行一次完整构建和 `site-verify`，失败时迁移终止，sandbox 保持转换前的 commit。
