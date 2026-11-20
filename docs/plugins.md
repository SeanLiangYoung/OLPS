# 插件

插件为网站增加功能。插件有两种能力：

- **声明式能力**：区块、注入到页面的片段（snippets）、前端脚本和样式、设置项、固定文字翻译。
- **服务器代码**：构建钩子和自定义 API，在 `isolated-vm` 隔离运行环境里执行。

插件的产物仍然是静态文件；需要服务器的功能通过 OLPS API 提供，见 [static-output.md](static-output.md)。

## 1. 插件包结构

```
plugins/<pluginId>/
  plugin.json
  sections/<sectionName>/      区块，格式与主题区块相同，类型名为 plugin/<pluginId>/<sectionName>
  snippets/<name>.liquid       注入到页面的片段
  assets/                      前端脚本、样式、图片
  server/
    build.js                   可选，构建钩子
    api.js                     可选，自定义 API
  languages/
    en.json
    zh-CN.json
```

## 2. `plugin.json`

| 字段 | 说明 |
|------|------|
| `schemaVersion` | OLPS 文件格式版本，当前为 `1` |
| `id` / `name` / `version` / `author` / `description` | 基本信息 |
| `requires` | 需要的 OLPS 插件接口版本 |
| `settings` | 设置项定义，格式与区块字段相同，另有 `secret` 类型 |
| `snippets` | 注入规则：`{ file, position: "head" \| "body-end", scope: "all" \| "pages-with-block" }` |
| `assets` | 页面需要加载的脚本和样式 |
| `server` | `{ build?: "server/build.js", api?: "server/api.js" }` |
| `permissions` | 服务器代码需要的权限，见第 4 节 |

`permissions` 的格式：

```ts
type PluginPermissions = {
  store?: boolean
  inquiries?: boolean
  fetch?: string[]
}
```

`fetch` 每项为小写域名，不含协议、端口、路径和通配符。未声明的权限不能通过 `ctx` 使用。

## 3. 后台

- 「插件 → 已安装插件」：列表显示名称、版本、说明、状态，可以启用、停用、删除、打开设置。
- 「插件 → 上传插件」：上传 zip。校验规则与主题相同（见 [themes.md](themes.md) 第 8 节），另外检查 `server/` 下的脚本能被 `isolated-vm` 编译，文件类型增加 `server/*.js`。
- 设置页按 `settings` 自动生成表单。普通设置保存在 sandbox 的 `source/plugins.json`；`secret` 类型的设置加密后保存在数据库 `plugin_secrets` 表，只提供给服务器代码，不进入 Git，也不进入公开文件。
- 启用带服务器代码的插件前，后台列出 `permissions` 并要求网站所有者确认。确认人和时间写入 `source/plugins.json`；插件升级后权限列表变化时需要重新确认。

插件启用状态和普通设置保存在 `source/plugins.json`，随 Git 发布。

## 4. 服务器代码

服务器代码运行在 `isolated-vm` 里，没有 Node.js API，只能使用 OLPS 注入的接口。每次调用的内存上限为 128 MB；自定义 API 每次请求的执行时间上限为 5 秒，构建钩子的总执行时间上限为 60 秒。超出上限时立即终止并报错。

### 4.1 构建钩子（`server/build.js`）

导出两个可选函数：

| 函数 | 调用时机 | 能做的事 |
|------|----------|----------|
| `onBuild(ctx)` | 全部页面渲染之前 | 读取只读的网站数据（页面、内容类型、媒体元数据、设置）；返回需要额外写入的文件，路径限制在 `public/plugins/<pluginId>/` 下 |
| `transformHtml(html, pageInfo, ctx)` | 每个页面渲染之后 | 返回修改后的 HTML |

构建钩子抛出错误或超出上限时，构建终止，后台显示插件名称和错误原文。

### 4.2 自定义 API（`server/api.js`）

导出 `handle(request, ctx)`：

- 访客端的请求地址为 `/api/public/:siteId/plugins/:pluginId/*`。
- `request` 包含 `method`、`path`、`query`、`body` 和白名单内的请求头。返回 `{ status, headers, body }`。
- 执行的代码来自网站当前发布版本的插件文件。草稿预览使用 `/api/preview-access/:token/plugins/:pluginId/*`，执行 capability 所属草稿里的插件文件。

### 4.3 `ctx` 提供的接口

| 接口 | 权限 | 说明 |
|------|------|------|
| `ctx.settings` | 无需声明 | 插件的普通设置和 `secret` 设置 |
| `ctx.store` | `store` | 按网站和插件隔离的键值存储，保存在数据库 `plugin_store` 表 |
| `ctx.fetch` | `fetch: ["api.example.com"]` | 只能访问声明过的域名 |
| `ctx.inquiries.create` | `inquiries` | 创建询盘记录，进入询盘模块和营销集成的转化流程 |
| `ctx.log` | 无需声明 | 写入插件日志，在插件设置页查看 |

## 5. 前端脚本

插件的前端脚本在构建时由 esbuild 打包，文件名带内容哈希。追踪脚本在页面上提供 `window.olps.on(eventName, handler)`，插件可以订阅标准事件（见 [integrations.md](integrations.md)），也可以用 `window.olps.emit` 发出标准事件。

## 6. 内置插件

内置插件位于 `packages/builtin-plugins/<pluginId>/`，新建网站时复制到 sandbox 并启用。内置插件可以停用，不能删除。

| 插件 | 提供的区块 | 设置 | 说明 |
|------|------------|------|------|
| `inquiry-form` 询盘表单 | `plugin/inquiry-form/form` | 表单字段、通知邮箱、隐私同意勾选框 | 提交到 `/api/public/:siteId/inquiries`，附带广告来源和页面语言；成功后跳转到询盘提交成功页 |
| `whatsapp` WhatsApp | 无（悬浮按钮通过 snippet 注入） | 号码、按钮文字、位置 | 点击时发出标准事件「点击 WhatsApp」 |
| `google-maps` Google 地图 | `plugin/google-maps/map` | Maps JavaScript API key | 区块旁始终输出可读的地址文字；没有填写 key 时显示地址文字和指向 Google Maps 的链接 |

停用插件后，使用该插件区块的页面在构建时报错，后台列出这些页面。

`source/plugins.json` 的完整结构见 [design/sandbox-formats.md](design/sandbox-formats.md) 第 6 节。
