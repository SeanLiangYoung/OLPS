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

## 公开预览 API

供 API 等服务在**不写入** sandbox 的 `source/`、`public/` 的前提下，复用与 `buildSite` 相同的页面校验、Guide 校验与 HTML 渲染逻辑。

从包入口导入：

```typescript
import {
  computeBuildPlan,
  type LoadedWorkspace,
  type PlannedFile,
  type PublishConfig,
  type StoredPageJson,
} from '@olps/site-builder'
```

调用方组装 `LoadedWorkspace`：`settings`（站点设置）、`publishConfig`（至少含 `publicSiteUrl`；含询盘表单时需 `publicApiBaseUrl` 与 `siteId`）、`pages`（待预览的页面 JSON，可含草稿 `status: 'draft'`）。`computeBuildPlan(loaded)` 返回 `PlannedFile[]`，每项为相对 `public/` 的路径与完整 HTML 或 sitemap 内容；函数本身不读写磁盘。

预览结果与对同一 `LoadedWorkspace` 执行 `buildSite` 后 `public/` 内对应 HTML 文件字节一致（content 页、ads 关键词路由页、`index.html`、`sitemap.xml`）。
