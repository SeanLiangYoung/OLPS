# `@olps/render`

浏览器与 Node 共用的网站渲染包。

## 已提供能力

- `SourceReader` / `loadSiteModel`：从 sandbox 源构造 `SiteModel`
- `urls` / `links`：公开地址、相对链接与 `ContentRef` 解析
- `liquid`：`liquidjs` 引擎，开启 `strictVariables` 与 `strictFilters`；自定义 `fs` 只读取当前主题目录与已启用插件目录
- `filters`：`asset_url`、`media_url`、`image_srcset`、`link`、`t`、`format_date`、`format_number`
- `richtext`：TipTap JSON 转 HTML，并移除 `script`、事件属性与不安全链接
- `blocks`：8 个核心区块、主题/插件区块注册，以及按 Schema 校验后的区块树渲染
- `i18n`：固定文字查找（`source/i18n` → 主题/插件 `languages/`）；缺少时抛出含语言、来源、键名的错误
- `navigation`：面包屑、上一篇与下一篇、相关条目、列表与分页；`collection-list` 的 `listItems` 组装
- `template-context`：模板数据 `site`、`locale`、`locales`、`alternates`、`appearance`、`menus`、当前对象、`content`、导航、`list`
- `seo-head`：title、description、canonical、hreflang、x-default、Open Graph、Twitter、noindex
- `structured-data`：Organization、WebSite、LocalBusiness、内容类型 structuredData、ItemList、BreadcrumbList、FAQPage
- `renderTarget`：按模板查找顺序渲染完整 HTML；`mode` 为 `publish` | `preview` | `canvas`；`canvas` 为区块加 `data-olps-block`，不输出追踪配置
- `normalizeHtml` / `createMemorySourceReader`：规范化比较与内存源读取（Node 与 Chromium 共用）

## 测试 fixture

- `test-fixtures/sites/full-site/`：完整网站（地址、引用、文档渲染、SEO、导航）
- `test-fixtures/sites/render-blocks/`：Liquid 与区块渲染
- `test-fixtures/themes/minimal/`：最小主题包

## 脚本

- `npm test`：Vitest（含真实 Playwright Chromium 一致性用例）
- `npm run bundle:fixture`：将 `full-site` 打成浏览器可用的 JSON
- `npm run bundle:browser`：为 Chromium 测试打包 ESM bundle
