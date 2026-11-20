# 现有代码处置清单

本文件以当前分支 `sean/wp-style-cms` 为基准，规定现有代码在 CMS 改造中的处置方式。分类含义：

- **直接复用**：公共行为和公开 API 保持不变，只补充测试。
- **修改后复用**：保留职责和主要结构，修改数据模型或输出。
- **新开发**：当前仓库不存在。
- **移除**：目标能力完成并通过替代测试后删除。

移除必须在替代实现通过对应测试后进行，不能提前删除协作、迁移和发布恢复能力。

## 1. 根目录

| 路径 | 处置 | 说明 |
|------|------|------|
| `package.json` workspaces | 直接复用 | 通配目录可以容纳新包 |
| `package.json` build/test 脚本 | 修改后复用 | 按 `domain → render/runtime/connectors → site-builder → sync → remote → api → admin` 增加新包 |
| `package-lock.json` | 修改后复用 | 由 npm 安装依赖更新 |
| `.env.example` | 修改后复用 | 增加凭据加密、媒体、主题、插件、连接器和发布目标配置 |
| `docker-compose.yml` | 修改后复用 | PostgreSQL 服务保持，按真实集成测试需要补充服务 |

## 2. `packages/domain`

### 直接复用

- `UserRecord` 的账号字段。
- `DraftInitStatus`、`DraftStatus`、`DraftSyncStatus` 的名称；状态组合按 [state-models.md](state-models.md) 收紧。
- `SiteRecord` 与 `DraftRecord` 的 ID、版本和时间字段。

### 修改后复用

- `src/types.ts`：只保留账号、网站、草稿与同步记录；`siteId` 在 `DraftRecord` 中改为必填，`SiteRecord` 增加 `status`。
- `src/site-settings.ts`：改用新 `SiteSettings` 和默认中英文。
- `src/index.ts`：导出新领域模块。
- `package.json`：增加 `ajv` 与测试脚本。

### 新开发

```text
src/content.ts
src/blocks.ts
src/media.ts
src/locales.ts
src/required-pages.ts
src/collection-presets.ts
src/appearance.ts
src/plugins-config.ts
src/redirects.ts
src/publish-config.ts
src/validate.ts
src/schemas/*.json
```

类型与 Schema 以 [domain-model.md](domain-model.md) 和 [sandbox-formats.md](sandbox-formats.md) 为准。

### 移除

- `PageKind`
- `PageBody`
- 旧 `PageRecord`
- 旧 `SiteSettings` 中的 `analyticsEnabled`、`mapsEnabled`、`mapsApiKey`、`whatsappEnabled`、`whatsappNumber`、`whatsappLabel`

这些设置分别进入连接器或内置插件。

## 3. `packages/sync`

### 直接复用

以下能力保持公开行为：

```text
src/workspace.ts
src/agent-merge.ts
src/cursor-agent-runner.ts
src/agent-result.ts
src/git-bundle.ts
src/remote-client.ts
src/path-guard.ts
src/git-exec.ts
src/git-repo-layout.ts
src/workspace-metadata.ts
src/sync-intermediate.ts
```

保留的关键 identifier：

- `SyncWorkspace`
- `pull`
- `push`
- `continueAfterUser`
- `resolveConflictsWithAgent`
- `runCursorAgent`
- `remotePushBundle`
- `remoteDownloadBundle`
- `remoteCreateSite`

### 修改后复用

- `src/paths.ts`：增加新 sandbox 路径，移除单文件页面路径帮助函数。
- `src/validation.ts`：检查新目录结构，构建命令只从 `SyncBuildConfig.buildCommand` 取得。
- `src/workspace.ts`：初始化新的 manifest 和 `.gitignore`。
- `src/git-line-endings.ts`：补充图片、字体、视频和文档的二进制规则。
- `test-fixtures/*.mjs`：使用新内容目录和静态产物。

### 移除

本包没有需要整体移除的协作能力。

### 测试

全部 Git、bundle、Agent、并发、路径安全和远端失败测试保留。只更新测试网站文件和新目录断言。

## 4. `packages/render`

整包新开发，负责浏览器画布与 Node 构建共用的内容读取、链接解析、Liquid、区块、SEO、结构化数据和完整 HTML 渲染。

公开 API：

```ts
type RenderMode = 'canvas' | 'preview' | 'publish'

interface SourceReader {
  readFile(path: string): Promise<Uint8Array>
  listDirectory(path: string): Promise<string[]>
}

declare function loadSiteModel(reader: SourceReader): Promise<SiteModel>
declare function renderTarget(
  model: SiteModel,
  target: ContentRef,
  locale: LocaleCode,
  options: { mode: RenderMode },
): Promise<RenderedDocument>
```

`preview` 允许草稿引用，`publish` 只允许公开内容，`canvas` 增加编辑器所需属性。

## 5. `packages/site-builder`

### 直接复用

- `src/path-guard.ts` 的目录边界检查。
- `src/install.ts` 安装命令和 `src/cli.ts` 命令入口的职责。

### 修改后复用

- `src/build.ts`：保留构建入口，内部改用 `@olps/render`。
- `src/write-public.ts`：保留安全写目录行为，改为新产物计划。
- `src/assets.ts`：保留文件复制思路，加入媒体处理与内容摘要。
- `src/verify.ts`：改为新 `site-verify` 规则。
- `README.md`：改为新区块和整站预览流程。

### 新开发

```text
src/build-checks.ts
src/images.ts
src/bundles.ts
src/search.ts
src/sitemaps.ts
src/feeds.ts
src/llms.ts
src/redirects.ts
src/server-config.ts
src/preview.ts
```

### 移除

新构建流程通过后移除：

```text
src/load.ts
src/plan.ts
src/render-page.ts
src/html-document.ts
src/inquiry.ts
src/inquiry-runtime.ts
src/page-validation.ts
src/public-routes.ts
src/route-registry.ts
src/publish-urls.ts
src/rewrite-asset-urls.ts
```

旧 `StoredPageJson` 与单页 `computeBuildPlan` 测试改为 `SiteModel` 与整站构建测试。

## 6. 新运行包

以下全部新开发：

- `packages/plugin-runtime`
- `packages/tracking-runtime`
- `packages/connectors`
- `packages/builtin-themes`
- `packages/builtin-plugins`

这些包的公开 API 在实现前写入各包 README，并由 `services/api` 或 `site-builder` 使用，不能互相读取数据库。

## 7. `services/api`

### 直接复用

```text
src/auth-middleware.ts
src/sessions.ts
src/users.ts
src/password.ts
src/permissions.ts
src/draft-lock.ts
src/draft-ordinary-edit-guard.ts
src/draft-sync-state.ts
src/push-remote-transport-error.ts
src/remote-service-config.ts
src/remote-identity.ts
src/publish-history-site-association.ts
src/config.ts
src/server.ts
src/test-support/
```

保留账号、会话、权限、草稿互斥、远端身份、首次发布关联和测试服务能力。

### 修改后复用

- `src/db.ts`：保留连接池、事务与迁移入口；更新内容、知识库、Job、预览、营销和发布目标表。
- `src/migrate.ts`、`src/migration-sandbox.ts`：保留可重复执行和生产数据升级职责，加入内容转换。
- `src/drafts-service.ts`：保留 Pull/Push/continue，`reindexPagesFromSandbox` 改为 `reindexContentFromSandbox`。
- `src/workspace-bootstrap.ts`：创建网站记录后初始化新 sandbox、知识库和默认内容。
- `src/workspace-factory.ts`：保留 `SyncBuildConfig` 注入方式。
- `src/app.ts`：保留 Hono 与中间件，路由移到领域文件注册。
- `src/ai-client.ts`：保留 OpenAI 兼容调用，增加输出 Schema 校验。
- `src/collaboration-jobs.ts`：保留权限、记录与锁的行为，迁到 `jobs/runner.ts`。
- `src/collaboration-dashboard.ts`、`collaboration-reports.ts`、`collaboration-public.ts`：改用新索引与目标引用。
- `src/page-routes.ts`、`preview-build.ts`、`preview-capability-store.ts`、`preview-serve.ts`：改为当前草稿整站预览。
- `src/collaboration-knowledge.ts`：改为每个网站一个知识库与资料复制。

### 新开发

```text
src/content-sandbox.ts
src/content-index.ts
src/content-routes.ts
src/collection-routes.ts
src/media-routes.ts
src/theme-routes.ts
src/plugin-routes.ts
src/site-defaults.ts
src/content-conversion.ts
src/credentials.ts
src/jobs/
src/deploy-targets/
src/integration-routes.ts
```

### 移除

- `src/generate.ts`：由新 Job 生成流程替代。
- `src/page-sandbox.ts`：由 `content-sandbox.ts` 替代。
- `src/not-implemented.ts`：全部路由具备正式行为后移除。

### 测试

保留以下测试行为，并更新 fixture 与断言：

- 账号、会话、所有权和最后一名成员保护。
- 草稿写入互斥、冲突期间拒绝编辑。
- Pull、Push、continue、远端失败重试和首次发布。
- Agent 合并、已发布版本自动合并和版本快照。
- 迁移可重复执行、数据库事务和索引重建失败恢复。
- preview capability 的会话、期限和权限撤销。

旧页面 HTML、单页预览路径和模板生成断言由新区块、整站预览与 Job SSE 测试替代。

## 8. `services/remote`

### 直接复用

```text
src/git-store.ts
src/site-store.ts
src/site-lock.ts
src/safe-fs.ts
src/validation.ts
```

### 修改后复用

- `src/app.ts`：保留 bundle 与部署接口，增加产物 zip、清单和发布文件读取。
- `src/deploy.ts`：保留验证后原子切换公开版本，复制 `server-config/`。
- `src/public-static.ts`：支持新 404、语言路径和 `_redirects`。

### 新开发

- 发布产物 zip 下载。
- 文件清单与 SHA-256 接口。
- 发布记录需要的产物摘要。

### 移除

无。

## 9. `apps/admin`

### 直接复用

```text
src/session.ts
src/api.ts
src/pages/LoginPage.vue
src/components/ConflictDecision.vue
src/components/OwnersPanel.vue
src/main.ts
src/env.d.ts
```

### 修改后复用

- `src/App.vue`：新左侧菜单、顶栏、查看网站、切换网站和发布对话框。
- `src/router.ts`：使用新模块与编辑器路由。
- `src/workspaceGuard.ts`、`workspaceSession.ts`：保留选定草稿与导航保护，草稿 `siteId` 改为必填。
- `src/draftBusinessContext.ts`、`publishedSiteContext.ts`：按网站创建时即存在重新定义。
- `src/pages/DashboardPage.vue`、`PagesPage.vue`、`InquiriesPage.vue`、`IntegrationsPage.vue`、`ReportsPage.vue`：保留页面职责，替换数据结构。
- `src/pageEditSession.ts`：保留未保存提示和异步保存保护，增加 `revision`。

### 新开发

```text
src/pages/SitesPage.vue
src/pages/CollectionPage.vue
src/pages/MediaPage.vue
src/pages/appearance/
src/pages/settings/
src/pages/tools/
src/components/PublishDialog.vue
src/components/PreviewAdminBar.vue
src/components/MediaPicker.vue
src/editor/
```

### 移除

替代页面通过真实 API 测试后移除：

```text
src/pages/WorkspacePage.vue
src/pages/PublishPage.vue
src/pages/GeneratePage.vue
src/pages/PageDetailPage.vue
src/settingsLocales.ts
src/pagesBlankValidation.ts
```

### 测试

- 登录、session、草稿选择、冲突决定与成员组件测试保留。
- 协作、Push/Pull 重试、询盘和迁移历史 E2E 保留流程，更新路由与选择器。
- `settingsLocales.test.ts` 与 `pagesBlankValidation.test.ts` 在替代测试具备后移除。
- 新增编辑器画布、区块保存、整站预览 admin bar、切换网站和发布对话框的浏览器测试。

## 10. 修改顺序

1. 确定 `packages/domain` 类型、Schema 与默认内容。
2. 修改 `packages/sync` 路径和测试 fixture。
3. 开发 `packages/render` 与运行包。
4. 改造 `site-builder`，完成整站构建和预览。
5. 修改 API 数据库、内容读写、知识库、Job 与发布。
6. 修改 remote 产物接口。
7. 修改管理界面。
8. 完成旧数据转换，再移除旧实现。

数据库、构建、预览和管理界面不能在领域类型确定前分别定义同名类型。
