# 营销集成

营销集成是后台的独立模块，负责连接第三方广告和分析平台：安装追踪代码、发送转化、记录广告来源、取回投放数据。

## 1. 连接器

每个平台对应一个连接器。

| 连接器 | 连接方式 | 网站上安装的内容 | 转化 | 取回的数据 |
|--------|----------|------------------|------|------------|
| Google Analytics 4 | Google 授权登录，选择媒体资源 | gtag 衡量 ID | 询盘提交记为 `generate_lead` 并设为关键事件 | 访问量、来源、转化 |
| Google Ads | Google 授权登录，选择广告账户 | 转化标签、再营销代码 | 自动创建「询盘提交」转化操作；增强型转化；离线转化上传 | 花费、点击、转化、关键词 |
| Google Search Console | Google 授权登录 | 网站验证 meta 标签 | — | 展示次数、点击、收录状态 |
| Meta Pixel | Meta 授权登录，选择像素 | Pixel 代码 | 询盘提交记为 `Lead`；Conversions API | 花费、点击、转化 |
| Google Tag Manager | 填写容器 ID | GTM 容器代码 | 标准事件写入 `dataLayer` | — |
| TikTok Pixel | 填写像素 ID | Pixel 代码 | 询盘提交记为 `SubmitForm` | — |
| LinkedIn Insight Tag | 填写 Partner ID | Insight Tag | 填写转化 ID 后发送 | — |
| Microsoft Clarity | 填写项目 ID | Clarity 代码 | — | — |
| Microsoft Advertising UET | 填写 UET 标签 ID | UET 代码 | 询盘提交记为 `submit_lead_form` | — |

后台每个连接器显示为一张卡片：连接状态、已选账户、转化开关、最近一次数据同步时间、断开连接按钮。

## 2. 授权登录

- Google 使用 OAuth 2.0（`google-auth-library`），一次授权覆盖 Google Ads、Analytics、Search Console 和 Site Verification 的权限范围。
- Meta 使用 Facebook Login for Business，权限范围为 `ads_read`、`ads_management`、`business_management`。
- 回调地址为 `/api/integrations/oauth/:provider/callback`。授权完成后，后台从账户列表里选择广告账户、媒体资源或像素。
- 选择账户后，系统自动完成：
  - Google Ads：创建「询盘提交」转化操作。
  - GA4：把 `generate_lead` 设为关键事件。
  - Search Console：通过 Site Verification API 取得验证 meta 标签，下次发布后完成验证，添加网站并提交 sitemap。
- 访问令牌和刷新令牌用 AES-256-GCM 加密后存入数据库 `integration_credentials` 表，密钥来自环境变量 `CREDENTIALS_ENCRYPTION_KEY`。令牌失效时卡片显示「需要重新连接」。

使用的库：`google-ads-api`、`@google-analytics/admin`、`@google-analytics/data`、`googleapis`（Search Console、Site Verification）、`facebook-nodejs-business-sdk`。

## 3. 标准事件

网站只产生一套标准事件，每个连接器把它换成各自平台的事件。

| 标准事件 | 触发 | GA4 | Google Ads | Meta | TikTok | UET |
|----------|------|-----|------------|------|--------|-----|
| `page_view` | 页面打开 | `page_view` | 再营销 | `PageView` | `Pageview` | `page_view` |
| `inquiry_submit` | 询盘提交成功 | `generate_lead` | 「询盘提交」转化 | `Lead` | `SubmitForm` | `submit_lead_form` |
| `whatsapp_click` | 点击 WhatsApp | `contact` | — | `Contact` | `Contact` | `contact` |
| `phone_click` | 点击电话链接 | `contact` | — | `Contact` | `Contact` | `contact` |
| `email_click` | 点击邮箱链接 | `contact` | — | `Contact` | `Contact` | `contact` |
| `form_start` | 开始填写表单 | `form_start` | — | — | — | — |

后台以日常说法显示这些设置，例如「询盘提交算作转化」「点击 WhatsApp 算作转化」。

## 4. 访客端追踪脚本

- 每个页面只注入一个追踪脚本 `packages/tracking-runtime` 的打包结果 `dist/olps-tracking.js`；页面内 `#olps-tracking-config` JSON 提供已启用连接器的公开 ID、转化开关、Cookie 政策地址与语言文字。
- 预览页面不注入追踪脚本；是否注入由调用方（例如 `site-builder`）决定。
- 追踪脚本提供 `window.olps.on`、`window.olps.emit`、`window.olps.getAttribution`、`window.olps.getConsent`，供插件订阅和发出标准事件。
- 实现位置：`packages/tracking-runtime`（同意、广告来源、事件总线与 8 个平台适配器）。

## 5. Cookie 同意

- 对所有访客显示同意提示条，分为「必要」「统计」「广告」三类，提供「全部接受」「全部拒绝」「自定义」。提示条链接到 Cookie 政策页，文字按页面语言显示。
- 访客同意之前不加载任何第三方平台的代码。
- Google 使用 Consent Mode v2，默认全部为 `denied`，访客选择后更新。
- Meta 使用 `fbq('consent', 'revoke' | 'grant')`。
- 访客的选择保存在第一方 Cookie `olps_consent`，有效期 180 天。页脚的「Cookie 设置」链接可以重新打开提示条。

## 6. 广告来源记录

- 追踪脚本把访客进入网站时 URL 里的 `gclid`、`gbraid`、`wbraid`、`fbclid`、`ttclid`、`msclkid`、`utm_source`、`utm_medium`、`utm_campaign`、`utm_term`、`utm_content`，以及首次访问页面和来源网址，保存到第一方 Cookie `olps_attribution`，有效期 90 天。
- 询盘提交时附带这些信息，保存在 `inquiries.attribution`。
- 询盘列表显示来源平台、广告系列和关键词。

## 7. 服务器端转化

- 访客同意「广告」类 Cookie 时，询盘提交请求附带同意状态和 `event_id`。
- API 收到询盘后：
  - 向 Meta Conversions API 发送 `Lead`，`event_id` 与浏览器端相同，用于去重。
  - 向 Google Ads 发送增强型转化，邮箱和电话先做 SHA-256 哈希。
- 运营在询盘模块把询盘标记为「有效」时，带 `gclid` 的询盘向 Google Ads 上传一次离线转化。
- 每次发送的结果记录在 `conversion_deliveries` 表，失败时在询盘详情里显示原因，可以手动重新发送。

## 8. 数据取回

- API 进程内的定时任务每天取回一次投放和分析数据，存入 `marketing_metrics` 表（按网站、连接器、日期）。
- 仪表盘显示最近 30 天的访问量、询盘数、转化、花费和单次询盘成本。

## 9. 数据范围

- 公开 ID（衡量 ID、像素 ID、容器 ID 等）在发布时写入构建配置，进入公开页面。
- 凭据、令牌和服务器端转化需要的密钥只保存在数据库。
- 未发布的草稿按 `draftId` 保存集成配置；首次发布后关联到网站，按 `siteId` 管理。规则与询盘、报告相同，见 [admin.md](admin.md)。

## 10. 环境变量

| 变量 | 用途 |
|------|------|
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google 授权登录 |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API |
| `META_APP_ID` / `META_APP_SECRET` | Meta 授权登录与 Conversions API |
| `OAUTH_REDIRECT_BASE_URL` | 授权回调地址的前缀 |
| `ADMIN_PUBLIC_BASE_URL` | 后台公开地址；授权完成或取消后返回该地址，并恢复对应网站与编辑版本 |
| `CREDENTIALS_ENCRYPTION_KEY` | 凭据加密密钥（32 字节，base64） |

缺少任何一项时，对应连接器的「连接」操作直接报错，指出缺少的变量。
