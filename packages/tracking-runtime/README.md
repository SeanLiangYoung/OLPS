# `@olps/tracking-runtime`

网站页面里运行的追踪脚本，打包为 `dist/olps-tracking.js`。

## 能力

- Cookie 同意：必要 / 统计 / 广告；全部接受、全部拒绝、自定义；`olps_consent` Cookie 180 天
- 广告来源：`gclid`、`gbraid`、`wbraid`、`fbclid`、`ttclid`、`msclkid`、`utm_*`、首次页面与来源网址写入 `olps_attribution` Cookie 90 天
- 标准事件总线：`window.olps.on` / `window.olps.emit`；自动 `page_view`、`phone_click`、`email_click`、`form_start`
- 平台适配器：GA4、Google Ads、GTM、Meta、TikTok、LinkedIn、Clarity、UET；同意后加载；Google Consent Mode v2；Meta `fbq('consent', ...)`

预览页是否注入由调用方决定；本包只负责浏览器运行时行为。

## 测试

`npm test` 在真实 Playwright Chromium 中验证同意状态、标准事件、广告来源字段与同意前第三方请求数为 0。
