# CMS 逐项验收记录

验收要求、构建环境、原始日志位置和外部验收条件分别记录在实施计划和本地集成记录中。验证命令在仓库根目录执行。「集成通过」表示 2026-11-21 的日志中列出的用例实际通过。提交核对使用包含这些实现提交的 Git 历史。[Wave 计划](../plans/2026-11-20-wp-style-cms-wave-plan.md) · [本地集成记录](2026-11-21-cms.md)

- 已验证表示该项要求有对应的运行结果与断言。
- 待核验表示已有本地代码或测试结果，仍有具体条件需要取证。
- 待验收表示需要外部账号、真实服务、系统环境或生产备份。完成后记录执行命令、结果和对应的回执或产物。

## Wave 0　设计与测试基线

### W0-T1 固化设计文档

- 提交：`f5913ed`。
- 验收要求：`git diff --check` 返回 0；所有新增相对链接指向存在文件；旧单页预览、可空 `siteId`、账号级知识库只允许出现在代码处置清单的移除说明中。
- 状态：已验证。
- 验证：`npm run check:docs`、`git diff --check` 返回 0；针对五份设计和实施文档执行术语检索。
- 证据：[设计索引](../README.md#详细设计)列出五份设计。相关术语仅在代码处置清单的旧测试替代说明中出现；新增相对链接检查全部通过。

### W0-T2 记录测试基线

- 提交：`647117c` 保存集成记录；`4093079` 为持续验收复查基线。
- 验收要求：`npm ci`、`npm run build`、`npm run typecheck`、`npm test` 全部返回 0；Git 工作区除计划内文档外无变化。
- 状态：已验证。
- 验证：`npm ci --include=optional`、`npm run build`、`npm run typecheck`、`npm test` 在 2026-11-21 集成时返回 0。
- 证据：[集成命令与日志](2026-11-21-cms.md#持续验收)记录本次复查，完整测试通过 135 份文件、448 项测试。`.intermediate/tdd.md` 保存环境与命令结果，PostgreSQL 为 `16.13`；`4093079` 提交后工作区为空。

## Wave 1　领域模型与 sandbox

### W1-T1 领域类型与 JSON Schema

- 提交：`b8281ad`。
- 验收要求：19 个 Schema 各有 1 个合法、1 个缺必填字段、1 个额外字段用例，共至少 57 个；另有至少 10 个跨字段规则用例；全部通过。
- 状态：已验证。
- 验证：`npm run build -w @olps/domain` 和 `npm test -w @olps/domain -- src/validate.test.ts` 对应构建和用例集成通过。
- 证据：[Schema 测试](../../packages/domain/src/validate.test.ts)逐个运行 19 组正例、缺必填字段和额外字段断言，另有 10 项跨字段断言。

### W1-T2 默认网站内容

- 提交：`6e8d4ba`。
- 验收要求：检查 16 个必备页面语言文件、3 个内容类型定义、角色唯一性、默认语言和全部引用；错误 fixture 至少覆盖缺页面、重复角色、空区块、失效媒体 4 类。
- 状态：已验证。
- 验证：`npm run build -w @olps/domain` 和 `npm test -w @olps/domain -- src/site-defaults.test.ts` 对应构建和用例集成通过。
- 证据：[默认内容测试](../../packages/domain/src/site-defaults.test.ts)检查两种语言、8 个必备页面、3 个内容类型、默认语言和引用，并拒绝要求中的四类错误。

### W1-T3 SyncWorkspace 新目录

- 提交：`83bcf14`。
- 验收要求：新增目录结构、缺 `buildCommand`、PNG、WOFF2、MP4、PDF 六组测试；现有 sync 测试全部通过。
- 状态：已验证。
- 验证：`npm run build -w @olps/sync` 和 `npm test -w @olps/sync` 在集成中通过。
- 证据：[sandbox 测试](../../packages/sync/src/sync-cms-sandbox-structure.test.ts)检查目录、manifest 规则、Git 忽略规则和四类文件往返后的字节比较。

## Wave 2　浏览器与 Node 共用渲染

### W2-T1 SiteModel、地址与引用

- 提交：`8f13f07`。
- 验收要求：覆盖页面、首页、404、总列表、两层分组、条目、分页 7 类地址；3 类地址冲突；4 类 `ContentRef`；`publish` 与 `preview` 两种引用规则。
- 状态：已验证。
- 验证：`npm run build -w @olps/render` 和 `npm test -w @olps/render -- src/urls.test.ts src/links.test.ts src/site-model.test.ts` 对应构建和用例集成通过。
- 证据：[地址测试](../../packages/render/src/urls.test.ts)和[引用测试](../../packages/render/src/links.test.ts)覆盖七类路由、三类冲突、四类引用，以及发布和预览对未发布对象与缺语言内容的处理。

### W2-T2 Liquid 与区块渲染

- 提交：`71fc6e9`。
- 验收要求：8 个核心区块各有正常用例；上述 5 类失败各有用例；TipTap 白名单覆盖 script、事件属性和安全链接 3 类。
- 状态：已验证。
- 验证：`npm run build -w @olps/render` 和 `npm test -w @olps/render -- src/liquid.test.ts src/blocks/render-tree.test.ts src/richtext.test.ts` 对应构建和用例集成通过。
- 证据：[Liquid](../../packages/render/src/liquid.test.ts)检查越界、未知过滤器与变量，[区块树](../../packages/render/src/blocks/render-tree.test.ts)覆盖八种区块和两类非法输入，[富文本](../../packages/render/src/richtext.test.ts)覆盖脚本、事件属性与链接协议。

### W2-T3 文档、SEO、导航与本地化

- 提交：`6b7b085`。
- 验收要求：检查 canonical、hreflang、x-default、Open Graph、noindex、5 类 JSON-LD、面包屑、上一篇与下一篇、相关条目；同一 fixture 的 Node/Chromium 规范化 HTML 比较结果为 0 差异。
- 状态：已验证。
- 验证：`npm run build -w @olps/render` 和 `npm test -w @olps/render` 在集成中通过。
- 证据：[文档渲染](../../packages/render/src/render-document.test.ts)、[结构化数据](../../packages/render/src/structured-data.test.ts)和[导航](../../packages/render/src/navigation.test.ts)覆盖列出的输出。[浏览器比较](../../packages/render/src/node-chromium-consistency.test.ts)确认同一 fixture 的英文简介页在发布模式下规范化 HTML 相同。

## Wave 3　插件、追踪、连接器与内置包

### W3-T1 plugin-runtime

- 提交：`193933d`。
- 验收要求：正常调用 3 类；拒绝超时、超内存、未授权域名、未声明权限、越界写入、脚本异常 6 类；共至少 9 个真实 isolate 用例。
- 状态：已验证。
- 验证：`npm run build -w @olps/plugin-runtime` 和 `npm test -w @olps/plugin-runtime` 在集成中通过。
- 证据：[isolate 测试](../../packages/plugin-runtime/src/plugin-runtime.test.ts)执行三个钩子以及六类拒绝断言。

### W3-T2 tracking-runtime

- 提交：`f739edf`。
- 验收要求：Chromium 中验证未同意、仅统计、全部同意、全部拒绝、重新设置 5 种状态；7 类点击或表单事件；9 类广告来源字段；同意前第三方请求数为 0。
- 状态：已验证。
- 验证：`npm run build -w @olps/tracking-runtime` 和 `npm test -w @olps/tracking-runtime` 在集成中通过。
- 证据：[Chromium 追踪测试](../../packages/tracking-runtime/src/tracking-runtime.test.ts)检查五种同意状态、事件类型、广告来源字段和首次同意前的网络请求。平台账户回执见 [W3-T3](#w3-t3-connectors)。

### W3-T3 connectors

- 提交：`741debd` 包含连接器实现及测试。
- 验收要求：真实测试账户完成 2 组 OAuth、账户列表、Google 转化创建、Meta 测试事件、Google 离线转化、GA4/Search Console/Ads/Meta 每日数据读取；每项都保存服务返回的真实 ID。
- 状态：待验收。
- 验证：`npm test -w @olps/connectors` 在集成中通过。外部命令为 `npm run test:live -w @olps/connectors`。
- 证据：默认测试覆盖连接器配置和输入。仍需真实的 Google、Meta 测试账号和对应的账号、转化、事件及指标回执。

### W3-T4 starter 主题与内置插件

- 提交：`e571aba`。
- 验收要求：1 个完整测试网站启用全部内置包后，未知区块数为 0、缺翻译键数为 0、缺模板数为 0；3 个插件各有启用和停用用例。
- 状态：已验证。
- 验证：`npm run build -w @olps/builtin-themes -w @olps/builtin-plugins` 和 `npm test -w @olps/builtin-themes -w @olps/builtin-plugins` 对应构建和用例集成通过。
- 证据：[渲染验收](../../packages/builtin-plugins/src/render-acceptance.test.ts)对完整网站检查三类缺失均为零，并逐个切换三个插件。

## Wave 4　网站静态构建

### W4-T1 整站构建与资源处理

- 提交：`5e33f61`、`55df5cb`、`b358ed5`。
- 验收要求：测试网站 2 种语言至少生成 26 个 HTML；每个公开路由 1 个 HTML；同一图片第二次构建命中缓存且 `sharp` 调用数为 0。
- 状态：已验证。
- 验证：`npm run build -w @olps/site-builder` 和 `npm test -w @olps/site-builder -- src/full-site-build.test.ts` 对应构建和用例集成通过。
- 证据：[整站构建测试](../../packages/site-builder/src/full-site-build.test.ts)验证 HTML 数量、各路由与产物的对应关系、资源摘要文件名和图片重复构建的零次 `sharp` 调用。

### W4-T2 隐藏文件、搜索、跳转与服务器配置

- 提交：`28bdf8c`、`741debd`。
- 验收要求：规定输出文件缺失数为 0；全部 sitemap URL 返回对应文件；2 条旧地址在 `public` 与 4 类配置中均可验证；Pagefind 两种语言各返回结果。
- 状态：已验证。
- 验证：`npm test -w @olps/site-builder -- src/full-site-build.test.ts src/auxiliary-output.test.ts` 返回 0，共 15 项通过。`npm run static:check -w @olps/api` 已完成三个部署环境的检查。
- 证据：以实际整站产物核对规定文件，使用 sitemap 解析库读取索引和各内容 sitemap，逐个读取页面、语言替代地址和图片对应的产物。两条旧地址均生成跳转页和四种服务器配置规则，Chromium 的两种语言搜索均返回结果。[整站构建测试](../../packages/site-builder/src/full-site-build.test.ts) · [静态辅助文件测试](../../packages/site-builder/src/auxiliary-output.test.ts)

### W4-T3 整站预览与 site-verify

- 提交：`0bff3bf`、`741debd`。
- 验收要求：预览 fixture 的全部站内链接返回 200；draft 路由可访问；公开构建中同一路由不存在；verify 覆盖服务器脚本、失效链接、内部地址、产物差异 4 类失败。
- 状态：已验证。
- 验证：`npm test -w @olps/site-builder -- src/preview.test.ts src/verify.test.ts` 对应用例集成通过，其中执行了 `node tools/site-verify.mjs`。
- 证据：[预览测试](../../packages/site-builder/src/preview.test.ts)验证根目录和子目录的页面链接，以及草稿路由在预览与发布中的差异。[验证器测试](../../packages/site-builder/src/verify.test.ts)覆盖四类失败与无依赖目录运行。

### W4-T4 资源专用发布判定

- 提交：`57f4d50`。
- 验收要求：允许情况 2 类、必须完整构建情况至少 6 类；摘要相同文件上传数为 0。
- 状态：已验证。
- 验证：`npm run build -w @olps/site-builder` 和 `npm test -w @olps/site-builder -- src/assets-only.test.ts` 对应构建和用例集成通过。
- 证据：[资源发布测试](../../packages/site-builder/src/assets-only.test.ts)验证两种仅更新资源、七种完整构建情形，以及同一清单产生空上传列表。

## Wave 5　API、内容与远端服务

### W5-T1 数据库与网站生命周期

- 提交：`741debd`。
- 验收要求：旧库升级一次成功、第二次数据和结构无变化；所有草稿空 `site_id` 行数为 0；每个网站知识库数量恰为 1；失败事务写入行数为 0。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/cms-schema.integration.test.ts` 通过，`src/cms-migration.integration.test.ts` 在集成中通过。
- 证据：用真实 PostgreSQL 的 `pg_dump` 和逐表 JSON 记录比较第二次升级前后的完整结构和数据。缺少网站 ID 的草稿为零，网站具备唯一知识库，创建失败后的五表行数保持一致。[Schema 专项测试](../../services/api/src/cms-schema.integration.test.ts)

### W5-T2 网站创建与知识库复制

- 提交：`741debd`。
- 验收要求：新站包含 16 个必备页面语言文件、3 个内容类型、1 个主题、3 个插件；复制到 2 个网站产生 2 个不同 `documentId`；修改来源后目标内容变化数为 0。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/cms-schema.integration.test.ts src/cms-knowledge.integration.test.ts src/cms-app.integration.test.ts` 对应用例集成通过。
- 证据：[网站生命周期](../../services/api/src/cms-schema.integration.test.ts)从新站读取 16 个语言版本、3 个内容类型、3 个插件，检查资料副本独立。[HTTP 集成测试](../../services/api/src/cms-app.integration.test.ts)通过网站接口使用默认主题构建整站预览。

### W5-T3 内容文件、索引与 API

- 提交：`741debd`。
- 验收要求：4 类内容各完成 create、read、update、delete；2 个并发 revision 请求恰有 1 个成功、1 个 409；索引失败前后四张表逐行相等；不兼容内容类型修改 4 类均返回影响清单。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/content-routes.integration.test.ts src/content-sandbox.integration.test.ts` 返回 0，两项通过。`src/content-fields.integration.test.ts` 在集成中通过。
- 证据：四类内容均完成新建、读取、更新和删除，两个并发 HTTP 请求分别返回 `200` 和 `409`。索引约束失败前后的四张表逐行相等，源文件不变。四类不兼容修改均返回实际受影响的分组和条目。[内容事务测试](../../services/api/src/content-sandbox.integration.test.ts) · [HTTP 接口测试](../../services/api/src/content-routes.integration.test.ts)

### W5-T4 媒体、主题与插件 API

- 提交：`741debd`。
- 验收要求：媒体允许类型全部覆盖；被 3 个位置引用时删除返回 3 个 usage；主题和插件各覆盖合法包及路径越界、超量、非法类型、Schema 错误 4 类拒绝；密文中明文出现次数为 0。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/managed-resources.integration.test.ts src/package-install.test.ts` 返回 0，四项通过。`src/cms-plugin-api.integration.test.ts` 在集成中通过。
- 证据：受管资源测试覆盖九种允许的文件扩展名、阻止删除时返回三处引用、密文中无明文。主题和插件分别测试合法 ZIP 与路径越界、文件数量和大小超限、非法文件类型、Schema 无效拒绝。[受管资源测试](../../services/api/src/managed-resources.integration.test.ts) · [包安装测试](../../services/api/src/package-install.test.ts)

### W5-T5 旧内容转换

- 提交：`741debd`。
- 验收要求：旧页面数量与转换后页面数量一致；每页恰有 1 个 `core/html`；8 个职责齐全；引用资源全部登记；重复转换后 Git HEAD 不变。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/content-conversion.test.ts` 对应用例集成通过，测试中运行独立 `site-verify`。
- 证据：[转换测试](../../services/api/src/content-conversion.test.ts)逐个比较两张旧页面的 ID、语言和唯一 `core/html`，另有八个默认职责页面；网站共十页。两份媒体完成登记，重复执行保持同一 Git HEAD，独立验证器通过。

### W5-T6 remote 产物能力

- 提交：`741debd`。
- 验收要求：不存在地址返回 404；2 条 redirect 返回 301；zip 与发布目录文件集合及 SHA-256 完全一致；未授权管理接口全部返回 401。
- 状态：已验证。
- 验证：`npm run build -w @olps/remote` 和 `npm test -w @olps/remote` 在集成中通过。
- 证据：[远端产物测试](../../services/remote/src/remote-artifacts.test.ts)实际请求 404、两个 301 与四类产物管理接口的 401，比较 ZIP 与清单中的文件及 SHA-256。

## Wave 6　API 业务能力

### W6-T1 当前草稿整站预览

- 提交：`741debd`。
- 验收要求：预览全部路由返回 200；admin bar 每页恰有 1 个；公开 HTML 中 admin bar 数为 0；过期、会话失效、撤权 3 类均返回 403；预览询盘外部发送记录数为 0。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/cms-preview.integration.test.ts src/cms-app.integration.test.ts src/cms-public.integration.test.ts` 返回 0，三项通过。
- 证据：核对双语言网站的整套预览与公开 HTML，包括首页跳转和 404 页面。每个预览地址通过真实 HTTP 返回 `200`，解析后恰有一个管理栏，所有公开 HTML 的管理栏数量为零。预览过期、退出登录和撤权均返回 `403`。Chromium 提交预览询盘后外部任务表为空。[真实 HTTP 与浏览器集成测试](../../services/api/src/cms-app.integration.test.ts)

### W6-T2 AI Job 与 SSE

- 提交：`741debd`。
- 验收要求：10 个 Job 类型各有成功用例；模型错误、Schema 错误、revision 冲突 3 类失败内容变更文件数为 0；SSE 断开继续后事件 ID 无重复且无缺失。
- 状态：待验收。
- 验证：`npm test -w @olps/api -- src/jobs/runner.integration.test.ts` 对应用例集成通过。模型场景使用 `npm run test:e2e:live -w @olps/admin`。
- 证据：[Job 测试](../../services/api/src/jobs/runner.integration.test.ts)提供本地执行和失败保护证据。需有真实模型的十种成功结果、三类失败文件快照和完整 SSE 重连记录。

### W6-T3 询盘、事件与报告

- 提交：`741debd`。
- 验收要求：同一 `eventId` 提交两次只产生 1 行；第一次标记 qualified 只产生 1 个离线转化任务；preview 来源产生外部任务数为 0；报告覆盖 4 类内容和全部语言。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/cms-public.integration.test.ts src/cms-reports.integration.test.ts` 对应用例集成通过。`npm run test:e2e -w @olps/admin -- e2e/cms-business.spec.ts` 对应浏览器用例在最终日志通过。
- 证据：[询盘业务测试](../../services/api/src/cms-public.integration.test.ts)核对幂等记录、qualified 任务及预览来源。[报告测试](../../services/api/src/cms-reports.integration.test.ts)覆盖四类内容与各语言。[真实 HTTP 浏览器流程](../../apps/admin/e2e/cms-business.spec.ts)提交预览和公开询盘。

### W6-T4 营销连接器

- 提交：`741debd`。
- 验收要求：Google 与 Meta 各至少 1 个成功发送记录；失败记录可以重试并增加 attempts；每日同步重复执行后同日同连接器行数为 1。
- 状态：待验收。
- 验证：`npm test -w @olps/api -- src/cms-marketing-metrics.integration.test.ts src/inquiry-delivery.integration.test.ts src/integrations.integration.test.ts` 对应用例集成通过。真实平台复查命令为 `npm run test:live -w @olps/connectors` 与 `npm run mvp:check`。
- 证据：本地结果覆盖指标读取、配置和任务重试。需取得两个真实平台的成功发送回执，并记录重复日同步的实际数据库计数。

### W6-T5 发布目标与发布记录

- 提交：`741debd`。
- 验收要求：5 类真实目标各完成首次、无变化、修改、删除 4 次同步；无变化上传数为 0；删除只影响 OLPS 曾上传的文件；单目标失败时其余目标成功数不变。
- 状态：待验收。
- 验证：`npm test -w @olps/api -- src/cms-publication.integration.test.ts src/deploy-targets/protocol.integration.test.ts` 对应用例集成通过。完整环境使用 `npm run mvp:check`。
- 证据：[发布测试](../../services/api/src/cms-publication.integration.test.ts)验证本地托管、FTP 增量、历史 ZIP 和独立重试。[协议测试](../../services/api/src/deploy-targets/protocol.integration.test.ts)涵盖 FTP、FTPS、SFTP 和 RustFS S3 协议。仍需真实云端目标，保存五类目标各阶段的同步记录。

### W6-T6 协作能力回归

- 提交：`741debd`，Agent 启动及目录隔离补充于 `b2d5d98`。
- 验收要求：两个账号分别完成无冲突合并、同对象不同区块合并、同区块冲突并 continue；最后一名网站成员无法删除；远端失败重试不增加重复网站或发布记录。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/cms-collaboration.integration.test.ts src/cms-agent-collaboration.integration.test.ts src/cms-remote-retry.integration.test.ts src/ownership.race.test.ts` 对应用例集成通过。
- 证据：[协作测试](../../services/api/src/cms-collaboration.integration.test.ts)与[真实 Agent 测试](../../services/api/src/cms-agent-collaboration.integration.test.ts)检查三类编辑，覆盖继续操作。[成员并发测试](../../services/api/src/ownership.race.test.ts)和[远端重试测试](../../services/api/src/cms-remote-retry.integration.test.ts)记录保留成员和重复记录约束。

## Wave 7　管理界面

### W7-T1 外框、我的网站与预览切换

- 提交：`741debd`。
- 验收要求：创建未发布网站、选择草稿、打开整站预览、返回原路由、切换网站 5 条 Playwright 流程全部通过；公开页面 admin bar 数为 0。
- 状态：已验证。
- 验证：`npm run build -w @olps/admin`、`npm run typecheck -w @olps/admin`、`npm test -w @olps/admin` 及 `npm run test:e2e -w @olps/admin` 对应构建和用例集成通过。
- 证据：[管理浏览器流程](../../apps/admin/e2e/cms-management.spec.ts)完成网站创建、草稿选择、顶栏预览、返回含查询参数的原地址和顶栏切换网站。API 全站用例逐个读取公开 HTML，管理栏数量均为零。

### W7-T2 内容列表、树与媒体

- 提交：`741debd`。
- 验收要求：4 类内容各完成新建、筛选、编辑入口和删除保护；两层分组拖动后顺序与 API 一致；媒体替换后引用 ID 不变。
- 状态：已验证。
- 验证：`npm run test:e2e -w @olps/admin -- e2e/cms-management.spec.ts e2e/cms-configuration.spec.ts e2e/cms-media-concurrency.spec.ts` 对应用例在最终浏览器日志通过。
- 证据：[内容验收](../../apps/admin/e2e/cms-content-acceptance.spec.ts)分别新建四类内容、提交搜索、打开编辑页面，并验证真实引用阻止删除；根层和子层实际拖动后，界面顺序与 API 返回顺序相同，均与操作前不同。[管理流程](../../apps/admin/e2e/cms-management.spec.ts)验证浏览器替换媒体后返回的 `mediaId` 保持相同。

### W7-T3 可视化编辑器

- 提交：`741debd`。
- 验收要求：8 个核心字段类型、3 种画布宽度、2 种语言、revision 冲突、离开保护、50 次撤销重做序列均通过；Node 与画布渲染 HTML 规范化差异为 0。
- 状态：已验证。
- 验证：`npm test -w @olps/admin` 与 `npm run test:e2e -w @olps/admin -- e2e/cms-editor.spec.ts` 对应用例集成通过。
- 证据：[字段组件测试](../../apps/admin/src/editor/FieldControl.test.ts)运行全部核心字段及真实 TipTap。[编辑器流程](../../apps/admin/e2e/cms-editor.spec.ts)核验三种宽度、两种语言、50 次撤销重做、版本冲突、取消导航保留输入；去除编辑包裹元素后，画布和 Node 预览的内容 HTML 完全相同。

### W7-T4 外观、插件与设置

- 提交：`741debd`。
- 验收要求：所有 10 个子页面可从菜单进入；主题与插件上传、启用、停用；不兼容内容类型修改显示受影响对象；secret 不回显原值。
- 状态：已验证。
- 验证：`npm run test:e2e -w @olps/admin -- e2e/cms-configuration.spec.ts e2e/cms-plugin-consumption.spec.ts` 对应用例在最终浏览器日志通过。
- 证据：[设置验收](../../apps/admin/e2e/cms-settings-acceptance.spec.ts)从菜单点击十个入口，安装真实主题与插件 ZIP，切换主题、启停插件、保存密钥后重新打开且输入为空；HTTP `409` 返回的受影响分组及条目显示标题，链接打开其已有语言的编辑页。与原配置流程合计四项浏览器测试通过。

### W7-T5 AI、询盘、营销与发布

- 提交：`741debd`。
- 验收要求：10 类 Job 均可发起并显示终态；SSE 重连不重复区块；一次发布显示 OLPS 托管和全部目标结果；冲突问答后同一操作继续完成。
- 状态：待验收。
- 验证：`npm run test:e2e -w @olps/admin -- e2e/cms-business.spec.ts e2e/cms-collaboration.spec.ts e2e/cms-publish-retry.spec.ts` 对应用例在最终浏览器日志通过。完整流程使用 `npm run mvp:check`。
- 证据：[业务浏览器测试](../../apps/admin/e2e/cms-business.spec.ts)确认十类任务请求与终态、询盘及发布记录，[继续发布测试](../../apps/admin/e2e/cms-collaboration.spec.ts)完成真实 Agent 问答。仍需带真实模型、营销账号及全部目标完成 [MVP 步骤](../flows/mvp-happy-path.md)，核验重连后的生成结果。

## Wave 8　清理、迁移与最终验收

### W8-T1 移除旧实现

- 提交：`741debd`、`dea5a73`。
- 验收要求：搜索 `PageKind`、`PageBody`、页面 `kind`、`body.html`、`StoredPageJson`、旧预览路由，运行时代码匹配数均为 0；替代测试全部存在。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/cms-upgrade.integration.test.ts` 通过。TypeScript 编译器读取生产入口的完整模块依赖，检查旧类型、页面属性、旧预览路由和旧页面表初始化语句，匹配数为零。
- 证据：[独立升级测试](../../services/api/src/cms-upgrade.integration.test.ts)确认 HTTP 启动依赖不含旧格式与升级模块，未完成升级时拒绝启动且保持数据库和文件；[升级命令](../../services/api/src/upgrade.ts)独立完成旧网站转换，失败可以重试，重复完成不修改版本记录，真实健康接口返回正常。协作、预览、内容及迁移的替代测试均保留。

### W8-T2 生产迁移演练

- 提交：`741debd`，本地验收记录见 `647117c`。
- 验收要求：升级前后用户、网站、草稿、询盘、报告、Job 数量逐项一致；页面与媒体转换数量一致；第二次迁移数据变化行数为 0；全部网站 build/verify 失败数为 0。
- 状态：待验收。
- 验证：`npm test -w @olps/api -- src/cms-migration.integration.test.ts src/content-conversion.test.ts src/cms-legacy-inquiries.integration.test.ts src/migration.sequence.tdd.test.ts` 对应用例集成通过。生产副本的执行命令见[迁移演练](../migration-rehearsal.md)。
- 证据：独立测试库覆盖迁移、业务记录与编号序列。仍需原始生产备份及对应网站目录，保存迁移前后 SQL 计数、逐站验证结果和重复执行比较。

### W8-T3 部署与业务验收

- 提交：`741debd`，部署与外部验收记录见 `647117c`。
- 验收要求：7 个环境逐项检查两种语言、搜索、分页、详情、404、redirect、隐藏文件，失败项为 0；MVP 20 步通过 20/20；Google 与 Meta 测试工具可见对应事件。
- 状态：待验收。
- 验证：`npm run static:check -w @olps/api` 完成本地三个环境。完整外部验收使用 `npm run mvp:check` 与 [MVP 流程](../flows/mvp-happy-path.md)。
- 证据：[静态部署记录](../static-deployment-rehearsal.md)保存 nginx 根目录、nginx 子目录和 `serve` 的实际结果。每个环境检查 167 个文件的 SHA256，并返回 8 条 Pagefind 搜索结果。仍需 IIS、真实 S3 静态端点、OSS、COS、完整 MVP 和平台事件 ID。

### W8-T4 文档与提交边界核对

- 提交：`741debd`、`647117c`。本记录与检查程序使用 `git log -1 -- docs/validation/cms-task-acceptance.md` 查阅提交。
- 验收要求：文档链接失效数为 0；实现中的公开路由与 API 文档差异数为 0；sandbox 文件与 Schema 清单差异数为 0；`git diff --check` 返回 0。
- 状态：已验证。
- 验证：`npm run check:docs`、`npm run test:docs`、`npm run build -w @olps/domain && node --test tools/check-cms-acceptance.test.mjs`、`npm test -w @olps/api -- src/cms-documentation.integration.test.ts`、`git diff --check` 均通过。
- 证据：[API 路由登记测试](../../services/api/src/cms-documentation.integration.test.ts)逐项比较 [122 组方法和路径](../../services/api/docs/routes.json)。[验收记录测试](../../tools/check-cms-acceptance.test.mjs)核对 37 项计划和提交可达性，比较 19 份 Schema 文件、设计清单及 domain 导出，差异均为零。
