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
9. [page-model.md](page-model.md) · [admin.md](admin.md) · [guide-multi-keyword.md](guide-multi-keyword.md)  
10. [architecture.md](architecture.md) · [from-lps.md](from-lps.md)

## 原则（极短）

- 用户通过本系统账号登录；用户与网站通过所有权关联表建立多对多关系。
- 已发布网站与 sandbox 草稿分别保存；通过 `push` 和 `pull` 同步，Agent 负责冲突处理与验证。
- 后台模块页面管理当前选择的**草稿**；技能和 CLI 接入明确的操作流程。
- 三类页清楚；广告引导可看可改；询盘保留；SEO/sitemap/三端为底座；多语言/地图/WhatsApp 可配置。  
- specs 尽量不改；skills 直接用。  
- 错误原样抛出。有业务判断的捕获改写成正常条件；只接住异常的捕获删除。  
- 设计按已确定的需求写全。当前没有的层次不加。  
- **管理 API**（`services/api`）与 **远端服务**（`services/remote`）分别部署；Push 部署与访客 HTTP 由远端承担，不由管理 API 单独完成。
