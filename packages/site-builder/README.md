# @olps/site-builder

将 CMS sandbox 中的 `source/pages/*.json` 与根目录 `assets/` 构建为访客可用的 `public/` 静态站点（HTML、SEO、广告关键词页、询盘脚本、sitemap、资源 URL 前缀）。

## 命令

```bash
npm run build -w @olps/site-builder
npm run test -w @olps/site-builder
```

测试包含 HTTP 静态服务、首页链接可达性、资源字节校验、junction 路径防护、guide 校验、Playwright Chromium 表单提交与重复提交行为等（无 mock）。

Playwright 用例里的本地 HTTP receiver 只断言浏览器是否发出预期的 POST、字段与 `pageId` 查询参数，以及失败响应后再次提交是否仍为 POST 且不导航；不覆盖 API 入库、鉴权、邮件通知等完整询盘业务。完整端到端询盘由主控在 API 就绪后另行验收。

## Sandbox 布局

见主仓库 `.intermediate/coordination/builder-api.md`（`assets/` 在 sandbox 根目录，与 @olps/sync 一致）。

## CLI

打包结果：`dist/site-build.mjs`。在 sandbox 根目录执行：

```bash
node tools/site-build.mjs          # 构建
node tools/site-build.mjs --verify # 校验产物
```

`installSiteBuilder(workspacePath)` 会把该文件安装到 `tools/site-build.mjs` 并更新 `olps.manifest.json`。安装前需先完成包的 `npm run build`。
