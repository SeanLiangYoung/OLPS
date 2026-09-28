# 首次发布与历史记录 site_id 关联

主控在 `.intermediate/coordination/migration-api.md` 维护跨 worktree 约定；本文件描述本 worktree 测试目标与后续 GREEN 范围。

## 迁移后未发布状态

- `inquiries`、`reports`、`jobs`、`analytics_events`、`site_integrations`、`inquiry_email_outbox` 等业务历史以 `draft_id` 归属，`site_id` 在库中为 null（外键不指向未发布的 pending 站点）。
- 读取 API 不得用草稿当前 `site_drafts.site_id` 推断已存储记录的 `site_id` 来绕过网站权限。

## 首次 push 后（GREEN 目标，由 publish 事务内 helper 实现）

- 在同一发布事务中，将上述历史行的 `site_id` 更新为本次创建或关联的真实 `sites.site_id`。
- `inquiry_email_outbox` 通过 `inquiry_id` 关联询盘；更新 `site_id` 时 `outbox_id`、`inquiry_id`、`payload`、`created_at` 不变。
- 其余字段（内容、主键、业务时间戳）保持不变。
- 网站 API（按 `siteId` 的列表与详情）对当前网站所有者可访问；`reports.site_id` 非空后按网站所有权判定读取权限。

## site_integrations 唯一性

- `site_integrations.site_id` 具有 UNIQUE：每个已发布站点至多一行站点级配置。
- 基于已发布站点再建草稿并 push 时，不得覆盖或重复插入冲突行；站点配置在网站维度唯一，多草稿可共享同一站点配置视图（具体合并策略在 helper 中实现）。

## 撤权

- 用户被撤销网站所有权后，即使仍是草稿所有者，也不得通过网站 API 或 `site_id` 已写入的历史记录接口访问已发布站点业务数据。
