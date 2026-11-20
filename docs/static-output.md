# 静态产物与发布

网站的最终产物是 `public/` 目录里的静态文件：HTML、CSS、JS、图片、字体、文档，以及 txt、xml、md、webmanifest 文件。nginx、Apache、IIS、对象存储静态网站、GitHub Pages、Cloudflare Pages 都可以直接提供这些文件，不需要 PHP、Node.js、.NET 等运行环境。

## 1. 可移植规则

- 每个页面输出为 `<目录>/index.html`，站内链接一律写成带结尾斜杠的目录地址。
- 站内链接和资源地址全部使用相对路径，同一份产物放在域名根目录或者任何子目录下都能运行。
- `canonical`、`hreflang`、`og:url`、sitemap、`llms.txt`、`feed.xml` 使用绝对地址，前缀为「设置 → 常规 → 网站地址」；没有填写时使用 OLPS 托管地址。
- 正文全部写在 HTML 里，不依赖脚本渲染。
- 列表分页输出为独立页面 `page/<n>/index.html`。
- 地址跳转用跳转页实现，不依赖服务器配置（见第 3 节）。
- 站内搜索用 Pagefind 在构建时生成索引，搜索在浏览器里完成。

## 2. 输出文件

| 路径 | 内容 |
|------|------|
| `index.html` | 跳转到默认语言首页的跳转页 |
| `404.html` | 默认语言的 404 页 |
| `<locale>/...` | 各语言的页面、列表页、分页、详情页、`404.html` |
| `<locale>/<prefix>/feed.xml` | 开启 `feed` 的内容类型的 RSS（用 `feed` 库生成） |
| `<locale>/.../index.md` | 每个页面的 Markdown 版本（用 `turndown` 从正文 HTML 转换） |
| `<locale>/llms-full.txt` | 该语言全部已发布页面的 Markdown 全文 |
| `llms.txt` | 网站简介和各语言的重要页面目录 |
| `sitemap.xml` | sitemap 索引，指向 `sitemap-pages.xml` 和每个内容类型的 `sitemap-<collectionId>.xml`；包含 `lastmod`、`hreflang` 对应关系和图片信息 |
| `robots.txt` | 收录规则、AI 爬虫规则、`Sitemap` 地址 |
| `favicon.ico`、`icons/*.png`、`apple-touch-icon.png`、`manifest.webmanifest` | 由「设置 → 常规」上传的网站图标生成 |
| `<IndexNow 密钥>.txt` | IndexNow 密钥文件 |
| `assets/uploads/...` | 媒体原文件，以及构建生成的 WebP 和多种尺寸 |
| `themes/<themeId>/...`、`plugins/<pluginId>/...` | 主题和插件的静态资源，文件名带内容哈希 |
| `pagefind/` | 站内搜索索引与脚本 |

`robots.txt`、`sitemap.xml` 等根目录文件只在网站部署在域名根目录时被搜索引擎读取。各文件的内容规则见 [platform-defaults.md](platform-defaults.md)。

sandbox 里另有 `server-config/` 目录，不属于 `public/`，随 zip 下载一起提供：

| 文件 | 用途 |
|------|------|
| `nginx.conf` | nginx 的 404 和 301 配置片段 |
| `.htaccess` | Apache 的 404 和 301 配置 |
| `web.config` | IIS 的 404 和 301 配置 |
| `_redirects` | Netlify、Cloudflare Pages 格式的 301 配置；OLPS 托管也读取这个文件 |

这些文件把 404 页和跳转升级为服务器级别的 404 状态码和 301 跳转，不放进 `public/`，网站不依赖它们运行。

## 3. 地址跳转

页面、分组、条目的 `slug` 修改后，旧地址记录在 `source/redirects.json`。构建时：

- 在旧地址输出跳转页，包含 `<meta http-equiv="refresh" content="0; url=<新地址>">`、`location.replace` 和指向新地址的 `canonical`。
- 在 `server-config/` 的四个文件里写入对应的 301 规则。

旧地址和现有页面地址冲突时，构建报错终止。

## 4. 404 页

- 每种语言输出 `/<locale>/404.html`，默认语言的版本同时输出为根目录 `404.html`。
- 404 页会在任意深度的地址下显示，所以这两个文件里的链接和资源使用 `<base href="<网站地址>/">` 加绝对地址。
- OLPS 托管对不存在的地址返回 `404.html`，状态码为 404。

## 5. 资源处理

- 图片用 `sharp` 生成 WebP 和宽度为 480、960、1440、1920 的版本（不超过原图宽度），输出 `srcset`、`width`、`height` 和 `loading="lazy"`。生成结果按原文件哈希缓存在 sandbox 的 `.olps-cache/`，该目录被 Git 忽略。
- 主题和插件的 CSS 与 JS 由 esbuild 打包压缩，文件名带内容哈希。
- 媒体原文件保持原路径。

## 6. 构建运行位置

- 构建由 API 进程调用 `@olps/site-builder` 完成。`sharp` 和 `isolated-vm` 是原生模块，构建程序从 API 的安装目录加载它们。
- `@olps/sync` 执行构建时，使用 API 传入的 `SyncBuildConfig.buildCommand`，指向 API 安装的 `@olps/site-builder` 命令行程序。Cursor Agent 处理冲突时使用同一条命令。
- sandbox 的 `olps.manifest.json` 只保存 `verifyCommand`，指向 `tools/site-verify.mjs`。这是一个纯 JS 的单文件程序，remote 部署前运行它检查产物。
- 预览使用同一套构建流程，一次构建当前草稿的全部内容和资源，包含 `draft` 对象，不注入追踪配置。站内链接在同一 capability 下完整可用。

## 7. 发布前检查

`site-verify` 检查整个 `public/`，下面任何一项不满足时报错终止，并指出具体文件：

- 存在服务器脚本文件：`.php`、`.phtml`、`.asp`、`.aspx`、`.ashx`、`.asmx`、`.jsp`、`.jspx`、`.cgi`、`.pl`、`.py`、`.rb`、`.shtml`
- 站内链接或资源指向不存在的文件
- 引用了 OLPS 内部地址（`publicApiBaseUrl` 除外）
- `public/` 与 sandbox 源码构建结果不一致

构建阶段另外检查：必备页面齐全、地址不重复、区块类型都有定义、站内引用都存在、固定文字都有翻译。

## 8. 需要服务器的功能

下列功能由网站页面跨域调用 OLPS API 完成。网站文件本身是纯静态的，这些接口不可用时只影响对应的功能。

| 功能 | 接口 |
|------|------|
| 询盘提交 | `POST /api/public/:siteId/inquiries` |
| 站内行为事件 | `POST /api/public/:siteId/events` |
| 插件自定义 API | `/api/public/:siteId/plugins/:pluginId/*` |
| 服务器端转化 | 由询盘提交触发，见 [integrations.md](integrations.md) |

OLPS API 对 `/api/public/` 路径开放跨域访问。

草稿预览中的询盘提交到 `/api/preview-access/:token/inquiries`，保存为来源草稿的预览询盘，不触发通知、营销转化和第三方事件。

## 9. 发布

「发布网站」把当前草稿发布到 OLPS 托管，再上传到用户配置的其他发布目标。

### 9.1 OLPS 托管

沿用现有的 Git bundle 推送流程（见 [site-collaboration.md](site-collaboration.md)）。OLPS 托管保存版本历史，是 Pull 的来源，每次发布都必须成功。remote 提供构建产物的 zip 下载接口。

### 9.2 其他发布目标

在「设置 → 发布目标」里配置，凭据加密后保存在数据库 `deploy_targets` 表：

| 目标 | 使用的库 |
|------|----------|
| FTP / FTPS | `basic-ftp` |
| SFTP | `ssh2-sftp-client` |
| S3 及兼容存储 | `@aws-sdk/client-s3` |
| 阿里云 OSS | `ali-oss` |
| 腾讯云 COS | `cos-nodejs-sdk-v5` |

- OLPS 托管发布成功后，API 从 remote 取得构建产物，依次上传到每个已启用的目标。
- 上传按文件的 SHA-256 与上一次上传记录（`deploy_target_files` 表）比较，只上传新增和变化的文件，只删除上一次由 OLPS 上传、这一次已经不存在的文件。
- 对象存储按文件类型设置 `Content-Type`；带内容哈希的文件设置长期缓存。
- 每个目标的上传结果单独记录。某个目标失败时，发布记录显示失败原因，可以单独重新上传。

### 9.3 下载 zip

每条发布记录都可以下载 zip，内容为 `public/` 和 `server-config/`，由 `archiver` 生成。

### 9.4 只发布静态资源

和网站当前发布版本相比，变化只涉及媒体文件的内容（替换了已有文件，元数据里只有大小、上传时间、上传人变化）时，构建只重新处理这些文件，页面 HTML 沿用上一次的结果。发布记录标明「只发布了静态资源」。其他发布目标只上传变化的资源文件。

### 9.5 发布记录

`publish_records` 表记录每次发布的时间、操作人、commit、发布类型（完整发布或只发布静态资源）和每个发布目标的结果。后台的发布记录显示时间、操作人和结果。

### 9.6 发布后的通知

发布成功后，API 用 IndexNow 通知 Bing 等搜索引擎更新的地址；连接了 Search Console 时提交 sitemap。
