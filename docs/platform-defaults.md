# 平台能力与站点配置

> OLPS 定位：面向运营的落地页特化 CMS（Landing CMS）。  
> 内容模型与发布管道从第一天带上下列能力所需的字段与结构。  
> **多语言、地图、WhatsApp agent** 是否启用及具体参数，由运营在站点设置中自行配置。

## 1. 产品形态

运营用 Admin 模块页管站；生成与改写由模块页触发固定流程。  
系统产出可索引、可配置多语言、可三端浏览、可挂地图与 WhatsApp、带 sitemap 的正式站点。

## 2. SEO（默认做好）

每条可发布页（三类皆是）在草稿阶段就具备结构化 SEO 字段，发布时写出合格页头与可抓取 HTML。

| 默认项 | 要求 |
|--------|------|
| 基础 meta | `title`、`description`；可覆盖，生成时自动给初值 |
| 规范链接 | `canonical`（多语言时指向正确 locale 版本） |
| Open Graph / Twitter | 最低：title、description、url、image（可占位） |
| 语义 HTML | 单 H1、标题层级合理；广告分屏也要有可抓取主内容策略 |
| 性能与可抓取 | 关键文案在 HTML 中可读 |
| robots | Site 级可配置；默认允许索引已发布页 |

广告页（`ads`）额外：

- 每个关键词入口对应**独立公开地址**（一词一址）；该地址下 SEO 字段按入口覆盖（至少 title/description）
- 分屏内容需有「主文档」可抓取策略；不可只有客户端切屏、爬虫一无所获

校验：发布前做 SEO 清单检查（缺 title/description/canonical → 警告或阻断，策略可配置，**默认警告并阻止空 title**）。

## 3. Sitemap（站点地图）

| 项 | 要求 |
|----|------|
| 自动生成 | 发布/下线后更新 `sitemap.xml`（及按需按 locale 分文件） |
| 收录范围 | 仅 `published` 的 `site` / `content` / `ads` 公开 URL |
| 多语言 | 启用多语言时使用 `hreflang` 或分 locale sitemap + 索引 |
| 提交友好 | Admin「发布中心」展示 sitemap 公钥 URL |
| 变更感知 | `lastmod` 跟页更新时间 |

## 4. 多语言（运营可配置）

| 项 | 要求 |
|----|------|
| 配置入口 | 站点设置：启用哪些 `locales`、哪个 `defaultLocale`、URL 策略（前缀或子域） |
| 页面按 locale 存内容 | 同一逻辑页可有多语言版本；`screenId` 跨语言稳定，文案层分离 |
| Admin | 切换语言编辑；列表可看「某语已发布 / 缺译」 |
| 生成流程 | 可为指定 locale 生成或翻译；不破坏其它语言 |
| SEO | 每语言独立 title/description + hreflang 互指 |

未配置多语言时，站点按单一默认语言运行；字段结构仍预留 `locale`。

## 5. Google 地图（运营可配置）

| 项 | 要求 |
|----|------|
| 配置入口 | 站点设置：是否启用、API key（不进仓库）、默认 zoom 等 |
| 块类型 | 页面模块 / 屏模块支持 `map`（地址或 placeId、zoom、标记） |
| 生成 | 生成器可按知识库中的地址填地图块 |
| 未启用或无 key | 显示地址文本 + 外链到 Google Maps，不白屏 |
| SEO | 地图旁保留可读地址文本 |

## 6. WhatsApp agent（运营可配置）

| 项 | 要求 |
|----|------|
| 配置入口 | 站点设置：是否启用、WhatsApp 号码或 agent 入口、展示文案等 |
| 访客侧 | 启用后，发布页按配置挂上悬浮入口（与 Guide 悬浮并存时可分区，不互相遮挡关键操作） |
| 未启用 | 页面不挂 WhatsApp 入口 |
| 与询盘 | 询盘表单与 WhatsApp 入口可同时存在；各走各的路径 |

## 7. 三端适配（PC / 平板 / 手机）

| 项 | 要求 |
|----|------|
| 默认响应式 | 所有生成模板与运行时布局默认覆盖三端 |
| 断点 | 约定最少三档（例如手机 &lt;768、平板 &lt;1024、桌面 ≥1024） |
| 广告分屏 | 屏内容、Guide 选项区在窄屏可点、可滚动；CTA 不依赖仅桌面悬停 |
| Admin 预览 | 预览器提供三端宽度切换 |

## 8. 与三类页面、Admin 的关系

```
生成 / 人工编辑（模块页触发）
        │
        ▼
 Page（含 locale、seo、blocks[含 map]、ads.screens+guide、询盘）
        │
        ▼
 响应式渲染 + SEO 头 + 已配置的地图 / WhatsApp
        │
        ▼
 发布 → 静态/托管 HTML + 更新 sitemap
        │
        ▼
 Admin：三类 · 发布态 · Guide 图 · 询盘 · 语言缺译 · sitemap · 站点配置
```

SEO、sitemap、三端是底座。多语言、地图、WhatsApp agent 是底座上的**可配置能力**。千人千面 Guide、报告、Ads/GA、询盘建在之上。
