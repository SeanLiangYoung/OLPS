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
- 标记 `translatable` 的设置支持按已启用语言分别保存，当前语言值进入区块与 snippet 的 `plugin.settings`。snippet 按声明的 `position` 和 `scope` 插入共享页面，预览与公开网站使用相同规则；编辑画布移除可执行脚本。
- WhatsApp 的号码默认留空，填写号码并启用插件后显示全站悬浮按钮。区块中的号码和文字优先使用区块资料，其他值使用插件设置；悬浮位置可以选择左下角或右下角。Google Maps 地址使用区块地址或插件的默认地址。
- Google Maps 使用官方 Maps Embed API 的 `place` iframe。`browserApiKey` 是明确公开的浏览器 key，保存在普通插件设置中；需要在 Google Cloud 启用 Maps Embed API，并限制允许的网站来源及 Maps Embed API。访客点击「显示交互式地图」后才创建 iframe；地址和外部地图链接始终可用。数据库密文不会自动复制到浏览器字段或公开文件。具体说明见 [Google 官方嵌入文档](https://developers.google.com/maps/documentation/embed/embedding-map) 与 [key 设置说明](https://developers.google.com/maps/documentation/embed/get-api-key)。
- 本机构建在每次执行前解密当前草稿的密钥，通过受信任构建命令的独立子进程环境传递；预览通过内存构建参数传递。只有服务器 isolate 的 `ctx.settings` 合并密钥，同名密钥覆盖普通设置。校验命令和浏览器渲染上下文不接收这些值，全局进程环境保持不变，构建日志中的密钥内容会被隐藏。
- 构建钩子和自定义 API 按 manifest 的 `settings` 补充普通字段默认值，显式设置优先，空字符串和 `false` 保持原值；列表里的设置递归应用相同规则。服务器保留多语言设置对象。`secret` 字段只读取数据库密钥，不使用 manifest 默认值或普通设置中的同名值。
- 上传候选版本时同步保存其插件密钥密文，托管成功后与网站发布指针一起更新当前发布密钥。响应丢失后的恢复使用同一候选密文；从已发布网站创建新草稿时继承已发布密钥，原草稿后来修改的未发布密钥不影响该副本。密文继续使用网站与插件范围，创建新草稿不改变加密范围。
- 启用带服务器代码的插件前，后台列出 `permissions` 并要求网站所有者确认。确认人和时间写入 `source/plugins.json`；插件升级后权限列表变化时需要重新确认。

插件启用状态和普通设置保存在 `source/plugins.json`，随 Git 发布。

## 4. 服务器代码

服务器代码由 `@olps/plugin-runtime` 在真实 `isolated-vm` isolate 中执行，没有 Node.js API，只能使用 OLPS 注入的接口。每次调用新建 isolate，内存上限为 128 MB；自定义 API 每次请求的执行时间上限为 5 秒，构建钩子的总执行时间上限为 60 秒。超出上限、权限不足、域名未声明、`onBuild` 路径越界或脚本抛出错误时立即终止，错误信息包含插件 ID。

### 4.1 构建钩子（`server/build.js`）

导出两个可选函数：

| 函数 | 调用时机 | 能做的事 |
|------|----------|----------|
| `onBuild(ctx)` | 全部页面渲染之前 | 读取只读的网站数据（页面、内容类型、媒体元数据、设置）；返回需要额外写入的文件，路径限制在 `public/plugins/<pluginId>/` 下 |
| `transformHtml(html, pageInfo, ctx)` | 每个页面渲染之后 | 返回修改后的 HTML |

构建钩子抛出错误或超出上限时，构建终止，后台显示插件名称和错误原文。

执行 `server/build.js` 前，插件必须已经保存服务器权限确认人和确认时间；没有确认时构建立即失败。纯前端插件不需要服务器权限确认。

构建钩子只能读取网站资料、设置和密钥，并通过 `ctx.fetch` 访问声明的域名；`store` 与 `inquiries` 仅用于自定义 API，构建阶段不能写入存储或创建询盘。同一个插件可以同时声明 `server.build`、`server.api` 和这些权限，构建时仅授予 `fetch`。网络请求禁止自动跟随重定向，单次最多 4.5 秒，并且受当前钩子的剩余执行时间限制；请求正文上限为 64,000 字节，响应正文上限为 1 MiB。

### 4.2 自定义 API（`server/api.js`）

导出 `handle(request, ctx)`：

- 访客端的请求地址为 `/api/public/:siteId/plugins/:pluginId/*`。
- `request` 包含 `method`、`path`、`query`、`body` 和白名单内的请求头。返回 `{ status, headers, body }`。
- 执行的代码来自网站当前发布版本的插件文件。草稿预览使用 `/api/preview-access/:token/plugins/:pluginId/*`，执行 capability 所属草稿里的插件文件。
- 公开调用同时绑定网站的发布记录、Git commit、普通设置快照和该记录的密钥密文。后来编辑草稿不会改变公开接口。网站必须处于已发布状态；插件需要启用、声明 `server.api`，并且已经确认服务器权限，否则返回 `404`。
- 预览调用重新检查 capability、登录会话和网站成员权限。预览存储按网站、插件和草稿分别保存，与公开存储隔离；预览创建的询盘标记为 `preview`，不创建邮件或营销转化任务。
- 请求体上限为 64,000 字节。插件可以读取 `Accept`、`Accept-Language`、`Content-Type` 和 `Idempotency-Key`；登录凭据和 Cookie 不传入插件。
- 响应状态范围为 `200` 至 `599`，禁止重定向状态。响应头仅允许 `Content-Type`、`Content-Language` 和 `Retry-After`，其中内容格式限于 JSON 或纯文本，字符编码为 UTF-8；响应正文上限为 1 MiB。服务设置 `X-Content-Type-Options: nosniff`、`Content-Security-Policy: sandbox; default-src 'none'` 和 `Cache-Control: no-store`。插件不能设置 Cookie 或跳转地址。
- `ctx.fetch` 继续检查声明域名，禁止自动跟随重定向，每次请求限制为 4.5 秒，响应正文上限为 1 MiB。插件日志隐藏当前插件的密钥；每次调用最多写入 100 条日志。
- `ctx.store` 的键名最长 200 个字符，单个值上限为 64,000 字节，每个网站、插件和来源范围最多 1,000 个键、总计 1 MiB。公开调用共享网站的公开存储；预览调用使用对应草稿的存储。

### 4.3 `ctx` 提供的接口

| 接口 | 权限 | 说明 |
|------|------|------|
| `ctx.settings` | 无需声明 | 插件的普通设置和 `secret` 设置 |
| `ctx.store` | `store`，仅自定义 API | 按网站和插件隔离的键值存储，保存在数据库 `plugin_store` 表 |
| `ctx.fetch` | `fetch: ["api.example.com"]` | 构建钩子与自定义 API 都只能访问声明过的域名 |
| `ctx.inquiries.create` | `inquiries`，仅自定义 API | 创建询盘记录，进入询盘模块和营销集成的转化流程 |
| `ctx.log` | 无需声明 | 写入插件日志，在插件设置页查看 |

## 5. 前端脚本

插件的前端脚本在构建时由 esbuild 打包，文件名带内容哈希。追踪脚本在页面上提供 `window.olps.on(eventName, handler)`，插件可以订阅标准事件（见 [integrations.md](integrations.md)），也可以用 `window.olps.emit` 发出标准事件。

## 6. 内置插件

内置插件位于 `packages/builtin-plugins/<pluginId>/`，新建网站时复制到 sandbox 并启用。内置插件可以停用，不能删除。

| 插件 | 提供的区块 | 设置 | 说明 |
|------|------------|------|------|
| `inquiry-form` 询盘表单 | `plugin/inquiry-form/form` | 表单字段、通知邮箱、隐私同意勾选框 | 提交到 `/api/public/:siteId/inquiries`，附带广告来源和页面语言；成功后跳转到询盘提交成功页 |
| `whatsapp` WhatsApp | `plugin/whatsapp/button`（联系页默认放入；悬浮按钮另可通过 snippet 注入） | 号码、按钮文字、位置 | 点击时发出标准事件「点击 WhatsApp」 |
| `google-maps` Google 地图 | `plugin/google-maps/map` | Maps Embed 浏览器公开 API key、默认地址 | 输出地址和 Google Maps 链接；配置浏览器 key 后，访客明确点击才请求官方交互式地图 |

停用插件后，使用该插件区块的页面在构建时报错，后台列出这些页面。

`source/plugins.json` 的完整结构见 [design/sandbox-formats.md](design/sandbox-formats.md) 第 6 节。
