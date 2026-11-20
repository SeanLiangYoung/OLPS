# `@olps/render`

浏览器与 Node 共用的网站渲染包。

## 已提供能力

- `SourceReader` / `loadSiteModel`：从 sandbox 源构造 `SiteModel`
- `urls` / `links`：公开地址、相对链接与 `ContentRef` 解析
- `liquid`：`liquidjs` 引擎，开启 `strictVariables` 与 `strictFilters`；自定义 `fs` 只读取当前主题目录与已启用插件目录
- `filters`：`asset_url`、`media_url`、`image_srcset`、`link`、`t`、`format_date`、`format_number`
- `richtext`：TipTap JSON 转 HTML，并移除 `script`、事件属性与不安全链接
- `blocks`：8 个核心区块、主题/插件区块注册，以及按 Schema 校验后的区块树渲染

## 测试 fixture

- `test-fixtures/sites/full-site/`：完整网站（地址与引用）
- `test-fixtures/sites/render-blocks/`：Liquid 与区块渲染
- `test-fixtures/themes/minimal/`：最小主题包

## 尚未包含（W2-T3）

完整文档渲染、SEO 头、导航数据、固定文字查找模块与 JSON-LD。
