# 用户与网站协作实施计划

执行分工：Codex 负责计划、接口协调、代码审查、merge 和独立验证；Cursor 负责代码实现、单元测试和相关文档更新。

## 目标与运行环境

实现 `docs/site-collaboration.md` 的完整流程。用户已选择本机可运行、可独立部署的服务，以及本系统账号密码登录。

使用 TypeScript、Vue、Hono、PostgreSQL 和 Git。管理 API、远端 Web 服务分别运行；sandbox 使用受管理的独立 Git 工作目录。冲突处理调用真实 Cursor Agent。服务运行目录和测试数据位于项目忽略目录中。

## 执行规则

- 每项行为先编写测试并运行，确认由于缺少该行为而失败，然后实现，再执行测试与回归检查。
- 保存每轮测试命令、失败原因和通过结果到各 worktree 的 `.intermediate/tdd.md`，验收记录使用最终结果。
- 禁止 mock、伪造 Agent 响应、伪造远端服务和仅用于通过测试的绕过逻辑。
- 使用真实 PostgreSQL 测试数据库、真实 Git 仓库、真实 HTTP 服务和真实 Cursor Agent。
- 通过文件编辑工具修改源码；禁止通过脚本批量改写源码。
- 禁止 Git 恢复代码操作及 cherry-pick。所有分支通过 merge 集成，冲突由 Cursor 编辑解决。
- 保留用户现有业务数据。开发和测试不迁移现有业务数据库；迁移测试在独立数据库中完成。历史数据的归属无法判定时明确终止并要求提供映射。
- 每个任务完成后提交其负责文件，报告 commit、测试结果和未解决事项。

## worktree 与文件职责

1. `sean/collaboration-api`：`services/api/**`、`packages/domain/**`、`.env.example`。负责账号、会话、数据库、所有权、草稿与业务 API、同步适配，以及数据库迁移测试。
2. `sean/collaboration-remote`：`packages/sync/**`、`services/remote/**`。负责 Git 工作目录、远端代码传输、版本检查、Web 服务、Cursor 冲突解决与实际服务测试。
3. `sean/collaboration-admin`：`apps/admin/**`、`docs/**`、`README.md`。负责用户界面、完整操作流程、真实组件测试与最终设计文档。

根目录依赖安装和执行脚本由集成阶段统一协调。各任务不得修改其他任务负责的文件。

## 数据与权限

- `users` 保存账号与安全的密码摘要；会话使用随机 token，数据库保存摘要和到期时间，支持退出登录。
- `sites` 仅保存已经成功发布的网站。`site_drafts` 保存 sandbox 工作副本，新草稿允许没有 `site_id`。
- 网站和草稿使用独立的多对多所有权关联，创建者获得所有权。网站所有者可以创建自己的草稿。
- 草稿页面和配置属于草稿，已发布版本通过远端 commit 固定。编辑操作不会改变线上内容。
- 页面、生成任务、知识库、询盘、报告和集成配置继续具有明确的用户、网站或草稿归属，并逐项检查权限。
- 首次发布创建网站并继承草稿所有权；更新发布使用已有网站标识。

## 管理 API 约定

返回字段统一使用 camelCase。失败返回 `{ error: string }`，身份无效使用 401，权限不足使用 403，资源不存在使用 404，版本或业务冲突使用 409。

- `POST /api/auth/register`、`POST /api/auth/login`：请求 `{ account, password, name? }`，返回 `{ accessToken, user }`。
- `GET /api/auth/me` 返回 `{ user }`；`POST /api/auth/logout` 撤销当前会话。
- `GET /api/sites` 返回 `{ sites }`，仅包含用户拥有的已发布网站。
- `GET /api/drafts` 返回 `{ drafts }`；`POST /api/drafts` 请求 `{ name, siteId? }`，返回 `{ draft }`。
- `GET /api/drafts/:draftId` 返回 `{ draft }`；`PATCH /api/drafts/:draftId/settings` 修改草稿配置。
- `GET/POST /api/drafts/:draftId/pages` 与 `GET/PATCH /api/drafts/:draftId/pages/:pageId`（及 guide、preview）提供草稿页面管理。
- `POST /api/drafts/:draftId/pull` 返回 `{ draft }`；`POST /api/drafts/:draftId/push` 返回 `{ draft, site }`。
- `GET /api/sites/:siteId/owners` 和 `GET /api/drafts/:draftId/owners` 返回 `{ users }`；同路径 `POST` 使用 `{ account }` 添加已有用户；`DELETE .../owners/:userId` 移除关联，最后一名所有者必须保留。
- 草稿包含 `draftId, siteId, name, settings, sandboxId, baseCommitId, headCommitId, status, createdAt, updatedAt`。
- 网站包含 `siteId, name, settings, remoteSiteId, publishedCommitId, publicUrl, createdAt, updatedAt`。
- 页面使用 `draftId` 标识编辑归属；公开询盘和事件使用已发布网站 `siteId`。
- 保留现有业务模块，涉及草稿的接口使用 `draftId`，涉及线上统计的接口使用 `siteId`。API 负责人将补充接口列表至共享进度文档，前端负责人按该列表接入。

## 任务一：账号与 API

1. 在 `services/api/src` 编写真实数据库测试，覆盖注册、重复账号、密码校验、会话撤销和未授权访问。运行 `npm run test -w @olps/api` 确认失败。
2. 实现账号与会话行为，运行相关测试直到通过。
3. 增加所有权、独立草稿、首次发布才出现网站记录、其他用户访问控制的失败测试，再实现数据库和 API。
4. 增加现有业务模块草稿归属和权限回归测试，再更新业务查询。
5. 通过同步模块接入真实远端服务；验证首次发布、更新发布、pull、并发提交、发布失败和冲突保留。
6. 在独立数据库验证迁移可重复执行、数据保留和无法确定所有权时明确终止。
7. 运行 API 测试及 TypeScript 构建，提交负责文件。

## 任务二：Git 同步与独立远端服务

1. 在 `packages/sync` 和 `services/remote` 编写真实文件与 HTTP 测试，覆盖创建仓库、版本内容传输、首次发布和浏览器获取页面；运行测试确认缺少行为。
2. 实现受控工作目录和真实 Git 版本保存；使用成熟工具处理文件格式和三方合并。
3. 实现独立远端进程：经过身份校验的代码传输和发布接口、完整源码获取接口、公开页面服务。公开访问只能读取当前成功发布内容。
4. 增加并发版本检查、失败发布保持线上内容、恶意路径和未授权写入测试，再完成相应实现。
5. 增加双向同步测试，覆盖双方独立修改合并、同一文件冲突、尚未提交的修改、重复 push 和 pull。
6. 调用真实 Cursor Agent 处理冲突。运行构建或内容校验，未解决冲突保留现场并返回明确状态。不得使用伪造 Agent 替代验收。
7. 提供管理 API 可调用的 TypeScript 接口及用法，在共享进度文件及时记录；执行全部测试及构建，提交负责文件。

## 任务三：后台与文档

1. 阅读 Vue 相关技能。为登录状态、网站和草稿选择、push/pull 状态与权限行为编写真实测试，运行确认失败。
2. 实现账号注册、登录、退出，已发布网站列表、草稿列表和草稿创建。
3. 将页面编辑、生成、配置等操作关联到当前草稿，保留现有业务模块；线上数据关联到已发布网站。
4. 提供所有者管理、push/pull、版本显示、冲突待处理和失败结果展示。需要用户处理时展示 Agent 返回的具体问题。
5. 使用真实后端完成多用户操作验证；禁止 mock fetch、模拟服务器或伪造后端数据。
6. 同步修改所有相关文档，使账号、网站、草稿、远端服务及启动测试说明一致。文档描述当前最终设计。
7. 运行组件测试、Vue 类型检查和构建，提交负责文件。

## 集成与验收

按依赖顺序 merge 三个分支，由 Cursor 完成集成修复并遵循同样的测试顺序。Codex 独立执行以下检查：

1. 全部单元测试、真实数据库测试、真实远端 HTTP 测试以及构建和类型检查。
2. 两个真实账号共同拥有网站，各自创建草稿；A 发布、B pull 合并再 push；浏览器 HTTP 请求读取最新页面。
3. 同文件冲突由真实 Cursor Agent 处理，验证双方可兼容的修改均保留。
4. 未授权操作、并发发布、部署失败、服务重启后的版本一致性。
5. 数据库结构与代码扫描确认所有业务层使用用户、网站和草稿模型；文档与实现一致。
6. 工作区差异检查与最终测试结果记录。
