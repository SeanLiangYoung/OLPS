# 知识库服务逐项验收记录

验收要求、构建环境与外部条件分别记录在 [Wave 计划](../plans/2026-11-25-knowledge-service-wave-plan.md) 与本地集成记录中。验证命令在仓库根目录或对应 worktree 根目录执行。

- 已验证：该项要求有对应的运行结果与断言。
- 待核验：已有本地代码或测试结果，仍有具体条件需要取证。
- 待验收：需要外部账号、真实模型或完整端到端环境。

设计依据：[knowledge-service.md](../design/knowledge-service.md)

## Wave 0　计划与测试基线

### W0-T1 固化 Wave 计划与验收清单

- 提交：`1804187`
- 验收要求：`npm run check:docs`、`git diff --check` 返回 0；计划与验收清单链接有效；`.worktrees/` 被忽略。
- 状态：已验证。
- 验证：`npm run check:docs` 返回 0（55 份文档、304 个本地链接、失效 0）；`git diff --check` 返回 0。
- 证据：[Wave 计划](../plans/2026-11-25-knowledge-service-wave-plan.md)；[验收清单](knowledge-service-acceptance.md)；`.gitignore` 含 `.worktrees/`。

### W0-T2 记录测试基线

- 提交：
- 验收要求：`npm run build`、`npm run typecheck`、`npm test` 全部返回 0；`.intermediate/tdd.md` 记录环境与退出码。
- 状态：待核验（build/typecheck 为 0；全量 test 因本机环境未全绿，见证据）。
- 验证：`npm run build`=0；`npm run typecheck`=0；`npm test`=1。
- 证据：`.intermediate/tdd.md`；失败归类含 symlink EPERM、缺 ffmpeg/openssl、CRLF stderr、themes 发布校验。

## Wave 1　服务脚手架

### W1-T1 包脚手架与 health

- 提交：`8b18c40`（合入 `2ab011f`）；测试入口修复见后续 `fix(knowledge)` 提交
- 验收要求：health 成功 1 例；缺令牌、错令牌各至少 1 例 401；`npm run build -w @olps/knowledge && npm test -w @olps/knowledge` 返回 0。
- 状态：已验证。
- 验证：worktree 与合入后 `npm test -w @olps/knowledge` 6 用例通过（修复 tsx 入口后）。
- 证据：`services/knowledge/`；`dev:knowledge` 已挂根脚本。

### W1-T2 站点项目目录初始化

- 提交：`c2921b6`（合入 `549f3de`）
- 验收要求：路径清单与设计一致；二次创建 diff 为 0；路径穿越被拒绝。
- 状态：已验证。
- 验证：`npm test -w @olps/knowledge` 返回 0（14 用例，含 project-init 8 例）。
- 证据：`project-layout.ts`、`site-id.ts`；`POST/GET /api/v1/projects*`。

### W1-T3 文件列表与读取

- 提交：`2d6ccba`（合入 `03efec6`）
- 验收要求：合法路径至少 3 类；越界/缺文件至少 2 类失败。
- 状态：已验证。
- 验证：`npm test -w @olps/knowledge` 返回 0（24 用例，含 files 10 例）。
- 证据：`project-files.ts`；`GET .../files` 与 `.../files/content`。

### W1-T4 API 侧客户端与建站挂钩

- 提交：`cc704d7`（合入 `2f8a96a`）
- 验收要求：新站创建后 knowledge project 存在；未启动行为符合测试约定。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/site-knowledge-project.integration.test.ts` 返回 0（2 用例）；`typecheck:test` 返回 0。
- 证据：事务提交后 ensure project；不可达抛 `KnowledgeProjectBootstrapError` 并 `DELETE` 补偿站点行；`docs/services.md` 已同步。

## Wave 2　导入与投影

### W2-T1 Postgres 投影表扩展

- 提交：`5e1edd2`（合入 `a6c2d42`）
- 验收要求：新列/新表存在；重复 upgrade 结构与数据 diff 为 0；现有知识库 CRUD 仍通过。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/knowledge-projection-schema.integration.test.ts` 返回 0。
- 证据：`cms-schema.ts` / `db-schema.ts`；`cmsUpgradeVersion` 已提升。

### W2-T2 导入任务创建与体积限制

- 提交：`1fe4b0a`（合入 `4486ffd`）
- 验收要求：至少 4 类拒绝；合法 zip 与文件夹各 1 例成功且相对路径保留。
- 状态：已验证。
- 验证：`npm test -w @olps/knowledge` 返回 0（33 用例，含 import 9 例）；`npm run build -w @olps/knowledge` 返回 0。
- 证据：`import-service.ts` / `import-queue.ts` / yauzl；状态目录 `.olps-knowledge/imports`。

### W2-T3 源文件分类与文本抽取

- 提交：`cc9eb2e`（合入 `888d885`）
- 验收要求：设计表扩展名各至少 1 fixture；未知扩展名 skipped≥1；指纹未变跳过数≥1。
- 状态：已验证。
- 验证：`npm test -w @olps/knowledge` 返回 0（49 用例）；`npm run build -w @olps/knowledge` 返回 0。
- 证据：`source-processing.ts`；mammoth/xlsx/pdf-parse/sharp；`extracted/` 与 `asset-meta/`。

### W2-T4 投影同步

- 提交：`37772b8`（合入 `64cea22`）
- 验收要求：只改投影后重建与 Wiki 一致；导入统计与投影行数一致。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/knowledge-projection-sync.integration.test.ts` 返回 0（3 例）；`npm test -w @olps/knowledge` 返回 0（49 例）。
- 证据：导入完成后自动投影；`POST .../projection/rebuild`；文档列表含 `kind`/`sourcePath`。

### W2-T5 手工资料门面改为经 knowledge 写入

- 提交：`be57b8a`（合入 `3654cd7`）
- 验收要求：写后 Wiki 与投影一致；复制到 2 站两个不同 `documentId`；改来源后目标变化数为 0。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/knowledge-manual-write.integration.test.ts src/cms-knowledge.integration.test.ts src/knowledge-projection-sync.integration.test.ts` 返回 0（7 例）；`npm test -w @olps/knowledge` 返回 0（49 例）。
- 证据：`POST .../pages/write` 创建/更新/删除；`POST .../manual-documents/:id/copy`；`cms-management-routes` 文档写路径不经仅改投影。

### W2-T6 Admin 资料包导入 UI

- 提交：`f553013`（合入 `274b0b0`；冲突已合并 `knowledge-service-client.ts`）
- 验收要求：上传测试 zip 后列表出现文档；超限错误文案明确。
- 状态：已验证。
- 验证：`npm test -w @olps/api -- src/knowledge-import-proxy.integration.test.ts` 返回 0（2 例）；手工门面与投影专项回归通过；`npm run typecheck -w @olps/admin` 返回 0。
- 证据：`knowledge-import-routes.ts`；`CmsKnowledgePage.vue` zip/文件夹导入与轮询；`docs/admin.md`。

## Wave 3　Ingest 与角色

### W3-T1 两步 Ingest 流水线

- 提交：
- 验收要求：产品1 类 fixture 来源页数≥文字文件数；续跑不重复指纹未变页。
- 状态：待验收。
- 验证：
- 证据：

### W3-T2 素材角色识别与 assets-catalog

- 提交：
- 验收要求：多 jpg 中至少 1 个非 `other` 或进入 review；按 role 过滤正确。
- 状态：待验收。
- 验证：
- 证据：

### W3-T3 再次导入 create/update/skip

- 提交：
- 验收要求：微调 update 且 id 不变；相同指纹无新副本；无关主题拒绝 update 并进 review。
- 状态：待验收。
- 验证：
- 证据：

### W3-T4 Reviews API 与 Admin 处理

- 提交：
- 验收要求：resolve 后待审减 1；改角色后投影一致。
- 状态：待验收。
- 验证：
- 证据：

## Wave 4　检索、提升与视频

### W4-T1 关键词检索 API

- 提交：
- 验收要求：标题命中≥1；role 过滤正确；空查询校验错误。
- 状态：待验收。
- 验证：
- 证据：

### W4-T2 Job 注入 knowledgeAssets

- 提交：
- 验收要求：快照资产数与 `asset_refs` 一致；未选资料不读库。
- 状态：待验收。
- 验证：
- 证据：

### W4-T3 promoteKnowledgeAssets

- 提交：
- 验收要求：保存后 `assetId` 出现次数为 0；二次提升复用 `mediaId`。
- 状态：待验收。
- 验证：
- 证据：

### W4-T4 新增 `core/video`

- 提交：`13a5280`（合入 `fc3ec0d`）
- 验收要求：正常渲染 1 例；缺 video 失败 1 例；非视频 mime 拒绝 1 例。
- 状态：已验证。
- 验证：`npm run build -w @olps/domain` 后 `npm test -w @olps/render -- src/blocks/render-tree.test.ts` 与 `npm test -w @olps/domain -- src/media.test.ts` 返回 0；`docs/page-model.md` 已更新。
- 证据：`packages/render/src/blocks/core/video.ts`；Admin `MediaPicker` 视频过滤。

### W4-T5 AI 建站页素材统计展示

- 提交：
- 验收要求：无资料统计为 0；有关联资产数量≥1。
- 状态：待验收。
- 验证：
- 证据：

## Wave 5　MCP、文档与总验收

### W5-T1 MCP 服务子集

- 提交：
- 验收要求：search 与读文件各至少 1 成功；HTTP 未启动失败信息明确。
- 状态：待验收。
- 验证：
- 证据：

### W5-T2 Agent Skill 说明包

- 提交：
- 验收要求：`npm run check:docs` 返回 0；链接目标存在。
- 状态：待验收。
- 验证：
- 证据：

### W5-T3 专题文档联动

- 提交：
- 验收要求：实现相关专题文档与代码一致；`npm run check:docs` 返回 0。
- 状态：待验收。
- 验证：
- 证据：

### W5-T4 设计 §11 总验收用例

- 提交：
- 验收要求：设计测试要点 1–7 各至少 1 条断言通过；根 build/typecheck/test 返回 0。
- 状态：待验收。
- 验证：
- 证据：
