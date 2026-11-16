# 网站管理与可视化编辑实施计划

> 执行者使用 superpowers:subagent-driven-development 或 superpowers:executing-plans，逐项实施并记录检查结果。用户已授权持续执行至完成。

目标：提供网站管理、HTML 可视化编辑、图片替换、Guide 属性编辑及所选页面发布。

架构：保留 Vue、Hono、PostgreSQL、Git 及静态构建。使用成熟编辑器处理页面结构；发布从固定候选快照执行，未选页面保留线上版本。

使用的技术：Vue、TypeScript、GrapesJS、Hono、PostgreSQL、sharp、parse5、现有 sync 和 site-builder。

设计：`docs/superpowers/specs/2026-10-26-site-admin-visual-editor-design.md`。

## 全局要求

- 当前目录的新分支继续开发，保留此前所有修改，不执行 Git 回滚。
- 使用 apply_patch 编辑文件；中间结果放入已忽略的 `.intermediate`。
- 注释及用户界面使用中文，identifier 保持英文。
- 检查使用真实数据库、文件和浏览器；不使用 mock，不使用视觉定位。
- 不访问 `/tmp`，不部署到外部网站，不推送共享分支。
- 独立任务分别负责文件，主执行者统一修改共享入口和依赖锁文件。

## 重点检查

- 未选页面及图片资源不会随其他页面发布。
- 保存、发布和远端成功后本地恢复均检查版本及权限。
- 任意已有 HTML 在没有修改时保持原文，未知内容明确保留。
- iframe 中的页面内容无法读取后台认证信息。
- Guide 复制、删除和跳转修改保持有效标识及路径检查。

## Task 1：选择发布与网站管理接口

文件：新增 `services/api/src/selected-publication.ts`、`selected-publication-routes.ts` 及真实集成测试；按需修改 `drafts-service.ts`、数据库迁移、sync 与 remote。

接口：在 `/api` 下挂载独立 router。`GET /drafts/:draftId/publication` 返回页面线上状态、差异、待删除及网站设置变化；`POST /drafts/:draftId/publication/preview` 接收 `{ pageIds: string[], includeSettings: boolean }`，返回 `{ token, pages, settingsChanged, issues, expiresAt }`；`POST /drafts/:draftId/publication/confirm` 接收 `{ token }`，返回发布任务及公开地址。采用 `pageIds`，页面状态决定更新、停止展示及删除，响应包含明确操作。

- [x] 编写并运行失败测试：发布一个页面不会发布另一个页面；停止展示和删除仅处理所选页面；过期预检及无权限拒绝；仅设置发布；远端真实输出。
- [x] 实现固定候选快照、独立构建、版本检查、幂等、任务查询及故障核对；未选内容及资源不进入发布历史。
- [x] 为新建网站和已有草稿提供网站入口所需关联，保留原有历史数据及权限。
- [x] 运行 API 与 sync、remote 相关回归，记录结果。

## Task 2：图片上传及编辑内容保存

文件：新增 `services/api/src/editor-assets.ts`、`editor-routes.ts` 及真实集成测试；按需新增迁移及独立保存模块。

接口：`POST /drafts/:draftId/assets` 使用 multipart `file`，返回 `{ asset: { assetId, url, previewUrl, name, width, height, mimeType } }`；`GET /drafts/:draftId/assets` 返回 `{ assets }`。持久正文使用 `url`，受权限保护预览使用 `previewUrl`。图片不可变，保存与发布使用 stable URL。

`PATCH /drafts/:draftId/pages/:pageId/editor` 接收 `{ body, expectedUpdatedAt, metadata? }`，允许保留尚有 Guide 问题的编辑内容，仍严格检查对象结构、路径、权限和版本；返回 `{ page, issues }`。公开构建保留严格 Guide 校验。

- [x] 编写失败测试：真实图片上传、无效图片、大小限制、权限隔离、不可变替换、版本冲突及保存未完成 Guide。
- [x] 使用 sharp 验证真实图片并保存到草稿 assets；实现安全预览、列表与资源元数据。
- [x] 实现编辑保存途径，保持现有普通保存行为。
- [x] 运行图片及保存真实数据库测试。

## Task 3：HTML 编辑器与页面详情

文件：新增 `apps/admin/src/components/VisualPageEditor.vue`、`apps/admin/src/editor/*`、相关测试；修改 `PageDetailPage.vue`。

接口：组件接收 `html`、`draftId`、广告 `ads` 与 `screenId`、页面候选；输出 `update:html`、`update:ads`、`dirty`。通过 Task 2 上传接口替换图片；页面保存使用 editor PATCH。页面发布使用共享 `PublicationPanel`，由 Task 4 创建。

- [x] 编写失败测试验证 HTML 保留、Guide 映射、复制标识、图片来源和系统组件。
- [x] 使用 GrapesJS 建立画布、内容目录、右侧属性、区域模板、撤销恢复、设备尺寸和编辑/体验模式，关闭编辑页面脚本与遥测。
- [x] 提供文字、图片、按钮、区域属性及 Guide 目标；保留复杂 HTML 并检查脚本隔离；支持上传替换和图库选择。
- [x] 页面详情提供正常保存、SEO、AI 改写翻译入口、设备预览及所选页面发布；未保存离开提示。
- [x] 执行组件及真实浏览器检查。

## Task 4：网站后台导航、列表与发布界面

文件：修改 `App.vue`、`WorkspacePage.vue`、`DashboardPage.vue`、`PagesPage.vue`、`SettingsPage.vue`、`PublishPage.vue`；新增 `components/PublicationPanel.vue`、网站状态工具及测试。

接口：`PublicationPanel` 接收 `draftId`、`pageIds`、可选设置变化入口；预检展示操作与问题，确认后发布并发出 `published`；使用 Task 1 的接口。旧地址保留兼容入口。

- [x] 编写失败测试验证列表搜索、语言/状态筛选、选择范围与网站归属。
- [x] 建立左侧固定导航、顶部网站信息与网站入口；概况显示业务数据和明确操作。
- [x] 实现页面筛选、多选、分页、独立线上与编辑状态；接入 PublicationPanel。
- [x] 设置单独发布，生成/改写/翻译保留上下文；历史数据继续可访问。
- [x] 运行后台类型检查和单元检查。

## Task 5：整体验收、审阅及交付

文件：新增 `apps/admin/e2e/visual-editor-publication.spec.ts`，更新操作文档与验收记录。

- [x] 使用真实 API 和浏览器完成新增页面、点击编辑、属性修改、真实图片上传、区域复制排序、Guide 修改、保存后重新打开、选择页面发布及公开输出检查。
- [x] 覆盖未选页面保护、并发修改、权限、发布失败和恢复；修复检查发现的问题。
- [x] 运行 `npm run typecheck`、`npm run build`、全部项目测试及适用的浏览器完整检查。
- [x] 独立审阅变更，修复发现的问题并执行相关回归。
- [x] 更新设计状态、操作说明和检查结果，按功能点提交修改；完成后通知用户。

检查结果见 `docs/superpowers/visual-editor-acceptance.md`。最终 API 56 个文件、225 项通过，全部六个项目425项通过，完整浏览器30项通过，Docker浏览器7项通过。
