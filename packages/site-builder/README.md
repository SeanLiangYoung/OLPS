# @olps/site-builder

将 CMS sandbox 中的 `source/pages/*.json` 与根目录 `assets/` 构建为访客可用的 `public/` 静态站点（HTML、SEO、广告关键词页、询盘运行时脚本与 API URL 注入、sitemap、资源 URL 前缀）。本包负责静态产物与校验，不负责询盘 API 入库或 Admin 展示。

## 命令

```bash
npm run build -w @olps/site-builder
npm run test -w @olps/site-builder
```

测试覆盖构建输出、路径防护、Guide 校验、资源 URL 改写、公开预览 `computeBuildPlan` 与 `buildSite` 一致性等；部分用例用本地 HTTP **仅提供静态文件**（首页链接、资源字节、广告屏内嵌资源在 Chromium 中的加载）。不在本包内启动伪 inquiry API 或断言 POST 业务结果。

访客询盘完整链路（普通页与广告 CTA、`POST` 201、`pageId`、数据库记录、Admin 列表、离线 `requestfailed` 后恢复提交）由主仓库 Admin 的 `public-inquiry.spec.ts` 在真实 API、remote 与 PostgreSQL 环境下验收。

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
