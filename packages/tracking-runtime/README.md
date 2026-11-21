# `@olps/tracking-runtime`

网站页面里运行的追踪脚本，打包为 `dist/olps-tracking.js`。

## 能力

- Cookie 同意：必要 / 统计 / 广告；全部接受、全部拒绝、自定义；`olps_consent` Cookie 180 天
- 广告来源：`gclid`、`gbraid`、`wbraid`、`fbclid`、`ttclid`、`msclkid`、`utm_*`、首次页面与来源网址写入 `olps_attribution` Cookie 90 天
- 标准事件总线：`window.olps.on` / `window.olps.emit`；自动页面浏览、电话、邮箱、表单开始、文件下载、外链与四个滚动进度事件
- 原生统计：公开构建提供 `eventCollector` 服务地址及内容目标，访客同意统计后向管理 API 发送标准事件；使用 `keepalive` 支持导航期间提交，询盘事件与服务端使用相同 `eventId` 去重
- 平台适配器：GA4、Google Ads、GTM、Meta、TikTok、LinkedIn、Clarity、UET；同意后加载；Google Consent Mode v2；Meta `fbq('consent', ...)`

公开构建注入配置与脚本；整站预览不注入追踪脚本。

## 测试

`npm test` 在真实 Playwright Chromium 中验证同意状态、标准事件、广告来源字段、同意前第三方请求数为 0，以及本机真实 HTTP 接收页面、下载、外链和滚动事件。
