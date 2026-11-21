# 静态部署验收

`npm run static:check -w @olps/api` 执行本地真实部署验收，需要 Docker 正常运行、项目依赖和构建产物已经准备完成，并且 Playwright Chromium 已经安装。脚本使用正式 nginx 容器与项目依赖中的 serve CLI，不需要数据库、AI 或营销账户。

## 执行范围

脚本建立完整默认网站，包含两种语言、八个产品、实际 PNG 图片、每页三个产品的分页，以及指向同一个产品的两个旧地址。随后执行正式构建和独立产物校验，将 `public/` 与 `server-config/` 打包到同一个 ZIP，并使用 `unzip` 解压。

三个部署环境都读取同一份解压后的 `public/`：

- nginx 根目录使用 ZIP 内的 `server-config/nginx.conf`。
- nginx `/catalog/` 子目录使用正式 `planServerConfig` 按该部署路径生成的配置，保留这份部署配置，公开文件字节保持不变。
- serve 使用正式 CLI 提供静态文件，浏览器执行产物中的 HTML 跳转。

检查使用真实 HTTP 和 Chromium DOM，包括：

- 全部公开文件的 SHA256，与 ZIP 解压内容逐个比较；结束后再次确认文件没有改变。
- 英文、简体中文、产品列表、第二页分页、产品详情，以及实际点击语言切换。
- PNG 图片成功解码；CSS、脚本和其他页面资源没有加载错误。
- Pagefind 在浏览器里读取索引、返回实际搜索结果，并进入搜索结果地址。
- 404 HTTP 状态与网站 404 页面内容。
- 两条旧地址：nginx 返回原生 `301`，serve 的 HTML 跳转在浏览器里到达正确产品。
- 根地址和两条旧地址都携带 `utm_source`、`gclid` 和 URL 片段进行检查；原生跳转响应保留查询参数，浏览器最终地址保留查询参数与片段。
- sitemap、robots、llms、完整语言文本、RSS 和页面 Markdown 可读取。
- `.git/config`、`source/site-settings.json`、`server-config/nginx.conf` 不能通过公开地址读取。
- ZIP 包含 nginx、IIS、Apache 和 `_redirects` 四种生成配置文件。

输出目录为 `.intermediate/static-deployment/<UTC时间>/`，保存 ZIP、解压文件、逐文件摘要、nginx 配置、serve 日志和 `results.json`。任何检查失败都会以非零状态退出并记录原始错误；脚本结束时关闭浏览器、serve 进程和测试容器。

## 2026-11-21 实际记录

本次记录目录为 `.intermediate/static-deployment/2026-11-21T07-08-19.418Z/`。`results.json` 为 `completed`，三个环境均通过上述检查，每个环境核验 **167 个公开文件**，Pagefind 返回 **8 条实际搜索结果**。每个环境的根地址和两条旧地址均通过查询参数与 URL 片段保留检查，共 **9 条实际跳转路径**。

- nginx：`1.28.3`，镜像为 `nginx:1.28-alpine`，实际镜像摘要为 `sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236`。
- serve：`14.2.8`。
- Chromium：`159.0.8154.6`。
- 同一 ZIP 的 SHA256：`18250f91951e35569751cda0b194fb40a724a76088cacd3a3befb6cf5cda6293`。

测试容器和 serve 进程已关闭。本次没有 Windows/IIS、真实 S3 静态网站端点、OSS 或 COS 环境，这四项保持未验收。此前 RustFS 检查了 S3 协议上传、类型和删除；S3 website endpoint 的目录首页、404、跳转及浏览器行为需要独立验收。完整外部平台验收见 [主流程验收](flows/mvp-happy-path.md)。
