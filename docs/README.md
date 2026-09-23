# 文档索引

## 先读

1. **[overview.md](overview.md)** — 白话需求  
2. **[tenant-context.md](tenant-context.md)** — 租户：登录后先选、可切换  
3. **[packages.md](packages.md)** — 包边界  
4. **[reuse-vs-rebuild.md](reuse-vs-rebuild.md)** — 复用 vs 重做  
5. [vision.md](vision.md) · [flows/mvp-happy-path.md](flows/mvp-happy-path.md) · [settings-scope.md](settings-scope.md)  
6. [platform-defaults.md](platform-defaults.md) · [model-defaults.md](model-defaults.md) · [storage.md](storage.md) · [services.md](services.md) · [error-handling.md](error-handling.md) · [design-scale.md](design-scale.md)  
7. [page-model.md](page-model.md) · [admin.md](admin.md) · [guide-multi-keyword.md](guide-multi-keyword.md)  
8. [architecture.md](architecture.md) · [from-lps.md](from-lps.md)

## 原则（极短）

- **多租户保留**：SSO → 先选当前租户 → 可切换；请求 = 账号 token + 当前租户。  
- 后台模块页管站；技能/CLI 挂在固定流程后；不靠对话猜租户。  
- 三类页清楚；广告引导可看可改；询盘保留；SEO/sitemap/三端为底座；多语言/地图/WhatsApp 可配置。  
- specs 尽量不改；skills 直接用。  
- 错误原样抛出。有业务判断的捕获改写成正常条件；只接住异常的捕获删除。  
- 设计按已确定的需求写全。当前没有的层次不加。  
- 一个后端进程启动时补数据库、建发布目录，然后接 SSO token。BFF 与 Redis 不在运行进程里。
