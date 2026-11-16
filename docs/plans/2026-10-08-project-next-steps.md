# 项目现状与下一步计划

检查日期：2026-10-08。

## 项目组成

- `apps/admin`：Vue 3、Vue Router、Vite。包含登录、工作区、页面、页面详情、生成、发布同步、询盘、报告、集成和设置页面。
- `services/api`：Hono、PostgreSQL。处理账号会话、网站与草稿所有权、页面索引、知识库、任务、业务记录、预览及同步协调。
- `services/remote`：独立 Hono 服务，接收 Git bundle，验证公开文件，按发布版本提供访客 HTTP 访问。
- `packages/domain`：用户、网站、草稿、页面和 Guide 类型，Guide 图校验与网站默认设置。
- `packages/sync`：草稿 Git 仓库、版本保存、Pull/Push、并发版本检查、同步状态保存及 Agent 冲突处理。
- `packages/site-builder`：读取网站源码，生成普通页和关键词广告入口、SEO、sitemap、资源文件和询盘运行程序，并验证输出内容。

PostgreSQL 保存账号、权限、索引和业务数据；草稿 Git 仓库保存可编辑源码与版本；远端保存已发布 Git 版本和公开文件。编辑操作使用 `draftId`，已发布网站业务使用 `siteId`。

## 功能现状

### 账号与协作

已提供注册、登录、退出、会话过期检查，网站与草稿分别支持多个所有者。移除所有者使用数据库事务检查最后一名所有者，发布时检查网站所有权。

依据：`services/api/src/app.ts`、`auth-middleware.ts`、`sessions.ts`、`collaboration-owners.ts`、`permissions.ts`；后台入口位于 `apps/admin/src/pages/LoginPage.vue` 和 `WorkspacePage.vue`。

### 页面、Guide 与发布

三类页面 `site`、`content`、`ads` 已支持创建、查询和编辑。广告页支持关键词独立地址、共用屏幕、Guide 编辑与校验、悬浮引导及浏览器后退处理。预览使用有过期时间的访问凭据，HTML、资源和广告运行程序通过网站构建器生成。

Pull/Push 已包含版本保存、远端并发检查、构建与验证、发布恢复、数据库索引更新、已发布页面快照和历史业务记录关联。远端验证成功后切换发布目录。

依据：`services/api/src/drafts-service.ts`、`page-routes.ts`、`preview-build.ts`、`packages/sync/src/workspace.ts`、`packages/site-builder/src/plan.ts`、`services/remote/src/app.ts` 和 `deploy.ts`。

当前 HTTP API 提供页面创建和编辑；页面删除、下线及明确选择本次发布页面的完整流程需要补充。当前 Push 将草稿内页面更新为 published，网站构建器读取目录内所有页面。

### Cursor Agent

冲突处理已包含提示文件、结果协议、日志、用户决定及继续执行流程。当前运行程序通过 `LOCALAPPDATA` 寻找 `cursor-agent.ps1`，使用 PowerShell 启动。macOS 和 Linux 的 CLI 调用需要实现；本地 CLI 登录成功与项目运行程序支持这些平台分别需要验证。

依据：`packages/sync/src/cursor-agent-runner.ts:16`、`agent-merge.ts`、`services/api/src/drafts-service.ts:476`。本次 macOS 测试已重现相关失败。

### 知识库与生成

知识库支持创建、文档保存、授权和访问检查。`retrieveKnowledge` 按查询词与文档标题、正文的包含关系评分，选择文档内容。生成任务记录 running、completed、failed 状态，将内容写入草稿页面。

`generatePageContent` 当前按 HTML 模板生成三类页面；`runGeneratePageJob` 将知识片段拼接到 brief，并使用 `locale: 'en'`。代码中尚未接入文档要求的业务模型调用、翻译和页面改写流程。

依据：`services/api/src/collaboration-knowledge.ts:136`、`collaboration-jobs.ts:44`、`generate.ts`、`apps/admin/src/pages/GeneratePage.vue`。

### 询盘、集成与报告

公开页面能够提交询盘，后台能够查询、筛选和修改状态；邮件重发接口写入 `inquiry_email_outbox`。当前需要补充邮件发送进程、发送状态和失败信息。

Google Ads/GA 支持账户标识与连接状态保存，尚需实际授权、令牌管理和 Google API 调用。

报告对草稿页面进行 SEO title、description、H1、viewport、locale 等本地清单检查，广告页额外检查屏幕和询盘标记。外部 URL 诊断、模型诊断和由报告发起优化需要继续实现。

依据：`services/api/src/collaboration-public.ts`、`collaboration-sites.ts:120`、`collaboration-sites.ts:386`、`collaboration-reports.ts:25`、`apps/admin/src/pages/InquiriesPage.vue`、`IntegrationsPage.vue` 和 `ReportsPage.vue`。

### 网站配置

网站设置已保存默认语言、语言列表、屏幕数量上限、行为采集、地图和 WhatsApp 字段；页面模型保存 locale，构建器写入 HTML lang、title、description 和 canonical，并生成 sitemap。

当前构建器尚需将地图、WhatsApp 和行为采集设置用于访客页面。多语言内容关联、语言地址、hreflang、翻译流程及缺少翻译的后台状态需要补充；SEO 还需要 Open Graph、Twitter 和完整 robots 配置。

依据：`packages/domain/src/site-settings.ts`、`types.ts`、`packages/site-builder/src/ads-pages.ts:43`、`html-document.ts:125`、`plan.ts:17`、`apps/admin/src/pages/SettingsPage.vue`。

## 下一步执行顺序

### 1. 完成跨平台 Cursor Agent 和测试基线

涉及文件：`packages/sync/src/cursor-agent-runner.ts`、`agent-merge.ts`、`sync-agent-merge.test.ts`、`sync-agent-needs-user.test.ts`、`sync-cursor-prompt-integrity.test.ts`、`sync-sandbox-meta-isolation.test.ts`，以及对应 API 冲突集成测试。

1. Windows 保留其 PowerShell 调用方式；macOS/Linux 使用实际安装的 CLI 可执行文件，按正式 CLI 参数传递任务和工作目录。将 `CURSOR_AGENT_COMMAND` 配置传入运行程序，当前该变量仅由 API 配置读取。
2. 实现各平台的超时终止、进程清理、完整输出记录和明确的缺少登录或程序错误。
3. 使用真实 CLI 验证双方可共同保留的修改，以及需要用户选择后继续 Pull/Push 的情况。
4. 元数据隔离测试分别写入不同状态，并重新打开两个工作目录验证状态和文件独立保存；当前两个元数据内容相同的断言失败，需要检查测试所验证的行为。
5. 为 Linux 容器提供明确的 CLI 安装及登录配置，完成容器内真实冲突处理验收。

验收：macOS、Linux 和 Windows 的真实冲突测试通过；用户决定后继续执行能够保留双方应保留的内容；公开 HTML、Git commit 和数据库页面快照一致；超时后没有遗留子进程。

### 2. 接入真实模型生成与改写

涉及文件：`services/api/src/generate.ts`、`collaboration-jobs.ts`、`collaboration-knowledge.ts`、`app.ts`、`config.ts`、`apps/admin/src/pages/GeneratePage.vue` 和 `docs/model-defaults.md`。

1. 使用成熟 SDK 接入可配置的模型服务，按照部署环境提供的 endpoint、model 和凭据发起真实请求。
2. 生成请求包含明确的知识库、目标语言、页面类型、关键词和 brief；保存所选文档及模型调用结果的关联信息。
3. 验证模型返回的页面、SEO、广告屏幕和 Guide，再写入草稿；失败时记录具体任务错误。
4. 支持基于现有页面的改写，保留 pageId、页面语言及业务关联。
5. 后台显示任务进度、错误及生成后的页面入口。

验收：真实知识文档进入模型输入，三类页面生成后均可预览并 Push；改写能够更新指定页面；指定语言生效；失败请求产生 failed 任务且保持原页面内容。

### 3. 完成页面删除、下线与发布范围

涉及文件：`services/api/src/app.ts`、`drafts-service.ts`、`page-sandbox.ts`、`packages/site-builder/src/load.ts`、`plan.ts`、`apps/admin/src/pages/PagesPage.vue` 和 `PublishPage.vue`。

1. 明确草稿状态、待发布状态和线上状态，提供删除及下线操作。
2. 发布时依据明确的页面选择或状态生成公开页面与 sitemap。
3. 更新已发布快照和索引，保证其他草稿 Pull 后能够看到页面删除与下线结果。

验收：下线页面的公开 URL 返回 404，sitemap 移除对应地址，其他公开页面继续访问；后续重新发布产生正确内容；多用户 Pull 后页面状态一致。

### 4. 完成访客配置、多语言与 SEO

涉及文件：`packages/domain/src/types.ts`、`packages/site-builder/src/ads-pages.ts`、`html-document.ts`、`plan.ts`、`services/api/src/collaboration-jobs.ts` 和后台页面、设置界面。

1. 将地图、WhatsApp 和行为采集设置传递至构建计划并生成对应访客内容。
2. 建立同一逻辑页面的语言关联、地址规则和翻译管理，生成 hreflang 与多语言 sitemap。
3. 完成 Open Graph、Twitter、robots、sitemap lastmod 和广告关键词入口 SEO。

验收：每项开关改变发布页面对应行为；访客事件能够通过真实浏览器写入数据库；两种语言地址和 SEO 正确；后台可识别缺少翻译的页面；电脑、平板和手机宽度下关键控件可操作。

### 5. 完成询盘邮件发送

涉及文件：`services/api/src/collaboration-public.ts`、`collaboration-sites.ts`、`db.ts`、`apps/admin/src/pages/InquiriesPage.vue`，新增邮件发送模块和独立运行入口。

1. 新询盘和人工重发都建立明确的发送任务。
2. 使用真实 SMTP 或邮件服务发送，保存尝试次数、发送时间、成功状态和错误信息。
3. 后台显示实际发送状态，并支持按明确规则重试失败任务。

验收：真实收件箱收到询盘邮件；无效凭据产生可查询的发送失败；重发生成可追踪任务；并发发送进程不会重复处理同一任务。

### 6. 完成 Google Ads/GA 与报告优化流程

涉及文件：`services/api/src/collaboration-sites.ts`、`collaboration-reports.ts`、`app.ts`、`db.ts`、`apps/admin/src/pages/IntegrationsPage.vue`、`ReportsPage.vue` 和模型调用模块。

1. 使用 Google 正式授权流程连接账户，保存并更新令牌，验证账户访问权限。
2. 查询真实广告和分析数据，按产品需求提供明确的调整操作。
3. 报告结合实际公开页面、网站数据和诊断结果，支持定位问题页面并发起改写。

验收：真实账户授权和令牌更新正常，后台数据与对应账户一致；撤销授权显示明确状态；报告中的页面和数据能够追溯，修改后能够重新诊断并发布。

### 7. 建立持续检查与依赖维护

涉及文件：`package.json`、各 workspace 的 `package.json`、`package-lock.json`、Vitest/Playwright 配置、新增持续集成配置和运行文档。

1. 根据已完成的跨平台运行方式建立构建、类型检查、单元测试、数据库集成测试和浏览器测试任务。
2. 对需要真实外部账户的模型、邮件、Google 和 Agent 测试配置明确的运行凭据与执行入口。
3. 分别处理 npm audit 报告的 `vitest`、`tinypool`、`@vitest/mocker`、`source-map-js`，检查升级后的 API 兼容与测试结果。
4. 增加数据库与网站 volume 的备份、恢复及运行日志检查步骤。

验收：干净检出能够按文档完成安装、构建、启动和测试；失败任务明确显示失败；恢复后账号、草稿、Git 历史及已发布页面可查询和访问。

## 本次 Docker 配置

`Dockerfile` 构建所有 workspace，运行镜像包含 Node.js、Git 和系统提交身份，管理后台由 Nginx 提供。`docker-compose.yml` 启动四个服务，配置服务间地址、健康检查、仅本机开放的端口及三个持久化 volume。

管理 API 通过 `HOST` 设置监听地址，默认 `127.0.0.1`，容器中使用 `0.0.0.0`。对应配置测试覆盖容器地址和默认地址。

启动和验收命令见 [本地 Docker 运行](../local-docker.md)。

## 本次验证结果

- `npm run build`：全部 workspace 构建通过。
- `npm run typecheck`：通过。
- `@olps/domain`：3 项测试通过。
- `@olps/site-builder`：18 项测试通过，包含真实浏览器广告资源访问。
- `@olps/remote`：24 项测试通过。
- `@olps/admin`：56 项单元测试通过；15 项真实浏览器测试通过，包含协作、预览、普通页及广告页询盘、网络中断重试、设置和权限检查。
- `@olps/api`：138 项测试通过，10 项失败。失败均在准备或执行真实 Agent 冲突流程时缺少 Windows `LOCALAPPDATA`。
- `@olps/sync`：32 项测试通过，4 项失败。其中 3 项依赖 Windows Agent 或 `powershell.exe`；另有 1 项元数据隔离测试对两个相同内容文件要求内容不同，需要按任务 1 验证独立状态保存。
- Docker：四个服务 healthy；容器内 `npm run mvp:check` 通过，完成注册、创建草稿、创建页面、Push 及已发布页面查询。
- Docker 重启：四个容器重启后均恢复 healthy，原有账号登录、草稿查询、页面预览及公开页面访问通过；后台代理、canonical、sitemap、源码访问限制和远端鉴权检查通过。
