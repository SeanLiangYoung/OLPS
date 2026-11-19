# 文档索引

## 先读

1. **[overview.md](overview.md)** — 白话需求
2. **[site-collaboration.md](site-collaboration.md)** — 本地账号、已发布网站、sandbox 草稿、独立远端与 Agent 双向同步
3. **[migration-rehearsal.md](migration-rehearsal.md)** — legacy 库备份、所有权映射、bootstrap、启动 API 迁移与快照演练验收
4. **[../services/api/docs/README.md](../services/api/docs/README.md)** — 管理 API 运行与迁移 CLI
   **[../services/api/docs/preview-access.md](../services/api/docs/preview-access.md)** — 草稿完整页面预览
   **[first-push-history-association.md](first-push-history-association.md)** — 首次 Push 后历史记录与 `site_id`
5. **[packages.md](packages.md)** — 包边界
6. **[reuse-vs-rebuild.md](reuse-vs-rebuild.md)** — 复用 vs 重做
7. [vision.md](vision.md) · [flows/mvp-happy-path.md](flows/mvp-happy-path.md) · [settings-scope.md](settings-scope.md)
8. [platform-defaults.md](platform-defaults.md) · [model-defaults.md](model-defaults.md) · [storage.md](storage.md) · [services.md](services.md) · [error-handling.md](error-handling.md) · [design-scale.md](design-scale.md)
9. [architecture.md](architecture.md) · [from-lps.md](from-lps.md)

## 专题

| 文档 | 内容 |
|------|------|
| [page-model.md](page-model.md) | 页面、必备页面、内容类型、媒体、区块、站内链接、发布状态 |
| [admin.md](admin.md) | 后台菜单、各模块、编辑器、发布网站、API |
| [themes.md](themes.md) | 主题包、模板、区块、外观设置 |
| [plugins.md](plugins.md) | 插件包、隔离环境、服务器代码、内置插件 |
| [integrations.md](integrations.md) | 营销平台连接、标准事件、Cookie 同意、广告来源、服务器端转化 |
| [localization.md](localization.md) | 网站语言、地址、翻译状态、固定文字 |
| [static-output.md](static-output.md) | 产物文件、隐藏文件、构建、发布目标 |
| [ai-generation.md](ai-generation.md) | AI 建站、生成、修改、翻译的 Job |

## 原则（极短）

- 用户通过本系统账号登录；用户与网站通过所有权关联表建立多对多关系。
- 已发布网站与 sandbox 草稿分别保存；通过 `push` 和 `pull` 同步，Agent 负责冲突处理与验证。
- 后台模块页面管理当前选择的**草稿**；技能和 CLI 接入明确的操作流程。
- 网站由页面、内容类型、媒体组成，正文是区块树；外观由主题决定，功能由插件提供。
- 网站产物是纯静态文件；需要服务器的功能调用 OLPS API。
- specs 尽量不改；skills 直接用。
- 错误原样抛出。有业务判断的捕获改写成正常条件；只接住异常的捕获删除。
- 设计按已确定的需求写全。当前没有的层次不加。
- **管理 API**（`services/api`）与 **远端服务**（`services/remote`）分别部署；Push 部署与访客 HTTP 由远端承担，不由管理 API 单独完成。
