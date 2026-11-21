# 营销集成接口

接口以 `/api` 为前缀。草稿集成操作需要登录，并验证网站和草稿权限。未发布网站使用草稿范围，首次发布后使用网站范围。公开追踪标识进入发布配置，OAuth 令牌加密保存在数据库。

## 读取与授权

- `GET /drafts/:draftId/integrations` 返回 `{integrations,revision}`。每个连接器包含 `connector`、`status`、`accountId`、`publicConfig`、`missingEnvironment`、`lastSyncedAt` 和 `error`，响应不包含 OAuth 令牌。
- `POST /drafts/:draftId/integrations/oauth/:provider` 创建授权状态并返回 `{url}`，`provider` 为 `google` 或 `meta`。
- `GET /integrations/oauth/:provider/callback` 接收授权平台返回的 `state` 和 `code`，或者取消授权的 `error`。状态绑定用户、会话、网站、草稿和服务提供方，有效期为十分钟，只能消费一次。

回调成功或用户取消后，以 303 返回 `ADMIN_PUBLIC_BASE_URL` 下的 `/integrations`，携带对应 `siteId`、`draftId` 以及 `connected=1` 或 `cancelled=1`。后台重新检查权限并恢复选择。返回地址使用服务器配置，默认 `http://127.0.0.1:5173`。

缺少 Google 或 Meta 环境配置时返回 503，包含缺少的变量名称。授权状态失效返回 400，平台请求失败返回 502，并隐藏令牌和原始敏感错误。

## 账户与公开标识

- `GET /drafts/:draftId/integrations/:connector/accounts` 查询真实授权账户，返回 `{accounts:[{id,name,metadata?}]}`，支持 `ga4`、`googleAds`、`searchConsole`、`meta`。
- `PUT /drafts/:draftId/integrations/:connector` 需要 `If-Match: "sha256:..."`。上述四种连接器接收 `{accountId}`，账户必须属于当前授权范围。响应为更新后的 `{integrations,revision}`。
- 其他五种连接器使用相同 PUT 地址，分别接收 `gtm: {containerId}`、`tiktok: {pixelId}`、`linkedin: {partnerId,conversionId?}`、`clarity: {projectId}`、`uet: {tagId}`。字段和标识格式经过严格检查。
- `DELETE /drafts/:draftId/integrations/:connector` 需要 `If-Match`，移除对应公开配置；同一提供方的其他连接仍在使用时保留授权凭据，成功返回 204。

Google Analytics 配置读取真实衡量 ID 并建立关键事件；Google Ads 配置建立或复用询盘提交和有效询盘两种转化动作；Search Console 返回真实验证标记；Meta 连接选择当前授权可访问的 Pixel。

## 指标与转化

`POST /drafts/:draftId/integrations/:connector/metrics/sync` 接收 `{date:"YYYY-MM-DD"}`，支持 Google Analytics、Google Ads、Search Console 和 Meta，成功返回 `{synchronized:true}`。定时同步读取已发布网站的昨日 UTC 数据，并按网站、连接器与日期更新唯一记录。

服务器转化由公开询盘任务触发，使用明确的广告同意，按网站、连接器、事件标识和转化种类保证幂等。预览不创建外发任务。未授权或配置不完整时保留明确的等待配置或失败结果。完整配置规则见 [营销集成说明](../../../docs/integrations.md)。
