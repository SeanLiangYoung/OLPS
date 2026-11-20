# 主题

主题决定网站的外观：页面模板、页眉页脚、样式、可用的区块，以及用户可以自定义的项目。模板语言为 Liquid，由 `liquidjs` 渲染。Liquid 模板不能执行任意代码，第三方主题可以直接安装。

## 1. 主题包结构

```
themes/<themeId>/
  theme.json
  screenshot.png
  templates/
    page.liquid
    page-<role>.liquid        可选，必备页面的专用模板
    collection.liquid         总列表页
    group.liquid              分组页
    item.liquid               详情页
    collection-<collectionId>.liquid   可选，某个内容类型的专用模板
    group-<collectionId>.liquid
    item-<collectionId>.liquid
  parts/
    header.liquid
    footer.liquid
    <其他片段>.liquid
  sections/
    <sectionName>/
      section.json            区块字段定义
      section.liquid          区块模板
      section.css             可选
      section.js              可选
  assets/                     样式、脚本、字体、图片
  languages/
    en.json
    zh-CN.json
```

## 2. `theme.json`

| 字段 | 说明 |
|------|------|
| `schemaVersion` | OLPS 文件格式版本，当前为 `1` |
| `id` / `name` / `version` / `author` / `description` | 基本信息 |
| `requires` | 需要的 OLPS 主题接口版本 |
| `settings` | 可自定义项定义，格式与区块字段相同；例如颜色、字体、Logo（媒体字段）、页脚文字 |
| `menus` | 导航位置，例如 `[{ "id": "primary", "name": "主导航" }, { "id": "footer", "name": "页脚导航" }]` |
| `templates` | 页面可选的额外模板，例如 `[{ "id": "full-width", "name": "全宽" }, { "id": "no-chrome", "name": "无页眉页脚" }]`，对应 `templates/page-<id>.liquid` |
| `styles` | 每个页面都加载的样式和脚本文件 |

`theme.json` 和 `section.json` 用 `ajv` 按 OLPS 提供的 JSON Schema 校验。

## 3. 模板查找顺序

| 对象 | 查找顺序 |
|------|----------|
| 必备页面 | `page-<role>.liquid` → `page.liquid` |
| 选了额外模板的页面 | `page-<template>.liquid` |
| 其他页面 | `page.liquid` |
| 总列表页 | `collection-<collectionId>.liquid` → `collection.liquid` |
| 分组页 | `group-<collectionId>.liquid` → `group.liquid` |
| 详情页 | `item-<collectionId>.liquid` → `item.liquid` |

`page.liquid`、`collection.liquid`、`group.liquid`、`item.liquid` 必须存在，缺少时安装失败。

## 4. 模板数据

| 变量 | 内容 |
|------|------|
| `site` | 网站名称、公司信息、网站地址、社交账号链接 |
| `locale` / `locales` | 当前语言、全部已启用语言 |
| `alternates` | 当前页面在其他语言下的地址 |
| `appearance` | `theme.json` 里 `settings` 的当前值 |
| `menus` | 每个导航位置的菜单项，链接已按当前语言换成相对地址 |
| `page` / `collection` / `group` / `item` | 当前渲染的对象（按模板类型提供） |
| `content` | 当前对象区块树渲染出的 HTML |
| `breadcrumbs` / `previous` / `next` / `related` | 内容类型的导航数据 |
| `list` | 列表区块和列表页的数据，包括分页信息 |

## 5. 过滤器

| 过滤器 | 作用 |
|--------|------|
| `asset_url` | 主题资源的相对地址（文件名带内容哈希） |
| `media_url` / `image_srcset` | 媒体的相对地址、图片的 `srcset` |
| `link` | 站内引用换成相对地址 |
| `t` | 读取固定文字的当前语言翻译 |
| `format_date` / `format_number` | 按当前语言格式化 |

`liquidjs` 开启 `strictVariables` 与 `strictFilters`，模板引用不存在的变量或过滤器时渲染报错，构建终止。模板只能读取主题目录内的文件。

## 6. 区块（sections）

每个 `sections/<sectionName>/` 定义一个区块，类型名为 `theme/<sectionName>`。

`section.json`：

| 字段 | 说明 |
|------|------|
| `name` / `description` | 区块库里显示的名称与说明；AI 生成时也读取这些说明 |
| `category` | 区块库分组，例如「主视觉」「内容」「行动号召」 |
| `fields` | 字段定义：`text`、`richtext`、`media`、`link`、`select`、`color`、`number`、`boolean`、`list`（可重复的子字段组） |
| `accepts` | 可以包含的子区块类型；为空表示不能包含子区块 |
| `preview` | 区块库里显示的示例 `props` |

区块模板接收 `block.props` 和 `block.children`（已渲染的 HTML）。

## 7. 外观设置

- 「外观 → 主题」：卡片显示截图和名称，可以启用、预览、删除、上传 zip。当前启用的主题不能删除。
- 「外观 → 自定义」：左侧是按 `settings` 自动生成的表单，右侧实时预览。保存到 `source/appearance.json` 的 `themeSettings`。
- 「外观 → 菜单」：为每个导航位置编辑菜单，菜单项可以是页面、内容类型、分组、条目或外部地址，支持拖拽排序和多级菜单。保存到 `source/appearance.json` 的 `menus`。
- 「外观 → 文字翻译」：修改主题和插件固定文字的翻译，见 [localization.md](localization.md)。

`source/appearance.json`、菜单项与主题设置值的完整结构见 [design/sandbox-formats.md](design/sandbox-formats.md) 第 5 节。

## 8. 安装与校验

- 内置主题位于 `packages/builtin-themes/<themeId>/`。默认主题的 `themeId` 为 `starter`，新建网站时复制到 sandbox 的 `themes/starter/` 并启用。
- 上传 zip 用 `yauzl` 解析，解压到 sandbox 的 `themes/<themeId>/`。下面任何一项不满足时直接拒绝，并说明原因：
  - 存在 `theme.json`，并且通过校验
  - 四个必需模板存在，所有 Liquid 模板可以被 `liquidjs` 解析
  - 文件类型只能是 `.json`、`.liquid`、`.css`、`.js`、`.png`、`.jpg`、`.webp`、`.svg`、`.woff`、`.woff2`
  - zip 内没有绝对路径和 `..` 路径
  - 解压后的总大小不超过环境变量 `THEME_MAX_BYTES`
- 同一 `themeId` 已存在时，上传视为升级，升级前后台显示版本变化。
- 主题文件随 sandbox 进入 Git，和网站内容一起发布、一起参与 Pull 与 Push 合并。

## 9. 切换主题

切换前，后台列出使用了当前主题区块（`theme/` 前缀）且新主题没有同名区块的页面。确认切换后，这些页面在编辑器里标出无法显示的区块，构建时直接报错，直到用户替换或删除这些区块。
