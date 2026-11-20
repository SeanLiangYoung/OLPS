# 网站业务记录归属

## 网站创建

- 新建网站时立即创建 `sites` 记录，状态为 `unpublished`。
- 同一事务创建网站成员、第一份草稿、草稿成员和网站知识库。
- `site_drafts.site_id` 必填。

## 业务记录

- `inquiries`、`reports`、`jobs`、`analytics_events`、`site_integrations`、`inquiry_email_outbox` 等记录创建时直接写入真实 `site_id`。
- 草稿专属操作同时写入 `draft_id`，例如 SEO 报告、AI Job 与预览询盘。
- 预览询盘的 `source` 为 `preview`，不会触发邮件、营销转化和第三方事件。
- 网站 API 按网站成员权限读取；草稿 API 同时检查草稿成员权限。

## 首次发布

- 首次发布成功时把 `sites.status` 从 `unpublished` 改为 `published`，写入远端标识、公开地址与发布 commit。
- 业务记录已经带 `site_id`，首次发布不需要迁移关联。
- 发布失败时网站保持 `unpublished`，已有草稿业务记录保持原有关联。

## 网站配置

- `site_integrations`、`deploy_targets` 和知识库按 `site_id` 归属，由同一网站的草稿共用。
- 草稿构建前，API 把网站配置中的公开部分写入该草稿的 `source/publish-config.json`。
- 插件普通设置随草稿进入 Git；插件密钥按网站与插件保存。

## 撤销权限

- 用户失去网站成员权限后，不能访问该网站的业务数据、知识库、营销配置和发布目标。
- 用户仍是某份草稿成员时，也不能借助该草稿读取已经无权访问的网站级数据。
