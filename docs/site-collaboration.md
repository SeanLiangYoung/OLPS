# 用户、网站与 Agent 协作

## 用户与所有权

- 一个用户代表一个登录账号。`users` 保存账号及用户资料，身份认证与登录会话由本系统管理（`POST /api/auth/register`、`POST /api/auth/login` 等）。
- 一个用户可以拥有多个网站，一个网站可以由多个用户共同拥有。
- 所有权通过关联表保存。服务端根据当前用户与目标网站或草稿的关联检查操作权限。
- 尚未发布的草稿也有独立的用户关联，支持多个用户共同拥有。
- 数据库、API、权限检查、后台交互和配置统一围绕用户、网站与草稿组织。

## 网站与 sandbox 草稿

新建网站时立即创建 `sites` 记录，初始状态为 `unpublished`，同时创建第一份草稿、网站成员、草稿成员和网站知识库。`sites` 包括网站标识、名称、状态、远端部署标识、访问地址、当前发布版本和更新时间。

`site_drafts` 记录仍在 sandbox 中编辑的网站工作副本，包括草稿标识、`sandbox_id`、内容位置、`site_id`、`base_commit_id` 和 `head_commit_id`。

- `site_id` 始终必填，每份草稿都属于一个已经创建的网站。
- `base_commit_id` 表示该草稿上次同步的网站版本；首次发布前可以为空。
- `head_commit_id` 表示该草稿当前已经保存的版本，sandbox 还可以包含尚未提交的修改。
- 同一个网站允许存在多个草稿，多个用户可以分别在自己的 sandbox 中修改同一个网站。
- 草稿内容与已发布内容分别保存，编辑草稿期间线上网站继续使用当前已发布版本。

首次发布成功后把网站状态改为 `published`，写入远端标识、访问地址与发布 commit。后续编辑通过该网站的草稿进行。

## 草稿写入互斥与内容索引

同一 `draft_id` 上所有会修改 sandbox Git 状态或内容索引表的业务写操作（settings、页面与内容类型的增删改、媒体上传与替换、主题与插件的安装和设置、AI Job、`pull` / `push` / `continue` 等）在进程内通过 `withDraftLock(draftId)` 串行化；不同草稿的锁互不影响。对外 HTTP 与 `drafts-service` 入口函数在持锁后调用实现；需要嵌套调用的路径（例如 `continue` 在待处理 `push` 时调用 `pushDraftUnlocked`）使用 `*Unlocked` 变体，避免同一线程重复加锁。

从 sandbox 的 `source/pages/`、`source/collections/`、`source/media/` 同步到 PostgreSQL `pages`、`collection_groups`、`collection_items`、`media` 时使用 `reindexContentFromSandbox`：在单条数据库连接上 `BEGIN`，按文件 upsert 并删除 sandbox 中已不存在的行，成功则 `COMMIT`。任一步违反约束（例如同一草稿同一语言下地址重复）则 `ROLLBACK`，四张表保持调用前的完整行集与字段值不变。

普通编辑入口在持有草稿锁后检查状态。`syncStatus` 为 `merge_conflict` 或 `awaiting_user`，或者草稿 `status` 为 `syncing` 时，内容、媒体、外观、插件、配置与 AI Job 返回 HTTP 409，并保持文件、Git 和数据库内容不变。`validation_failed` 状态允许修改内容以修复验证问题。

冲突期间 `source/site-settings.json` 等工作区文件可能仍含 Git 冲突标记。列表与单条草稿 API 读取 settings 时，在 `merge_conflict` 或 `awaiting_user` 状态下从 Git 已提交 HEAD 读取配置，保留工作区中的冲突内容。`push` 或 `pull` 在 Cursor Agent 处理之后，持久化 `workspace.getState()` 返回的实际 `syncStatus`、Agent 问题与 `validationLog`。

`POST .../continue` 在用户消息与 Agent 处理之后、恢复待处理的 `pull` 或 `push` 之前，将当前 `baseCommitId`、`headCommitId` 与同步状态写回 `site_drafts`，并保留尚未完成的 `pendingOperation`，以便 `SyncWorkspace.open` 的 HEAD 校验与 sandbox 一致。若 Agent 后仍为 `awaiting_user` 或 `merge_conflict`，则写回 HEAD 并返回 409；其余状态按原有 pending `pull`/`push` 流程继续验证与发布。

草稿预览的 HTTP 行为见 `services/api/docs/preview-access.md`（capability 路径、完整 HTML 与静态资源）。

## 独立远端服务

`push` 的目标是一个独立部署的远端服务（`services/remote`）。该服务同时接收网站代码并提供 Web 访问，浏览器通过网站访问地址获取已发布的页面和静态资源。

- 接收通过权限检查的代码提交，保存网站源码、相关配置及版本历史。
- 提供 `pull` 所需的版本信息和完整源码，供 sandbox 同步与继续编辑。
- 验证收到的版本及其公开文件，保证浏览器内容与已发布 commit 中的文件一致。
- 发布成功后切换网站的当前服务版本，通过 HTTP 或 HTTPS 向浏览器提供网站内容。
- 返回发布状态、commit 标识、部署标识和网站访问地址，使管理系统能够记录与远端一致的发布结果。
- 同一个网站的发布顺序和版本检查由远端服务统一执行；部署失败时继续提供当前成功发布的版本。

sandbox 承担编辑、Agent 冲突处理及验证。管理系统承担用户、所有权、草稿与发布操作的管理。远端服务承担代码接收、版本保存和线上网站服务。

## 网站版本历史

每个网站具有类似小型 Git 仓库的版本历史，支持 `push` 和 `pull`。版本内容包含完整源码及相关配置，使 sandbox 能够继续编辑、构建和发布。

版本保存、差异比较和三方合并采用 Git 能力。新网站草稿在首次发布前即可保存版本历史，首次发布后继续使用同一份历史。

网站的当前发布版本必须对应一次成功的远端部署。远端部署保存对应的 commit 标识，`pull` 使用该成功部署版本的完整内容。

发布记录保存目标版本、操作用户、部署状态和远端部署标识。部署失败时保留失败结果，网站当前发布版本保持不变。

## pull

1. 检查用户对网站和目标草稿的权限。
2. 读取网站当前成功部署的版本、草稿上次同步版本以及 sandbox 当前修改。
3. 根据共同起始版本执行三方合并，保留双方能够共同存在的修改。sandbox 中尚未提交的修改也必须纳入处理。
4. 由 Cursor Agent 处理冲突，并在 sandbox 中运行构建和相关测试。
5. 验证通过后保存合并版本，更新草稿的同步版本和当前版本。

首次编辑已有网站时，可以直接从当前已发布版本创建草稿。`pull` 更新 sandbox 内容。

## push

1. 检查用户对网站和草稿的权限。
2. 保存 sandbox 当前修改，读取网站最新发布版本，并根据共同起始版本完成合并。
3. 由 Cursor Agent 处理冲突，在 sandbox 中完成构建及相关测试。
4. 按网站协调发布顺序，并在发布前再次检查最新版本；版本发生变化时，重新合并和验证。
5. 将验证通过的确定版本推送到独立远端服务，由该服务完成部署并提供网站 Web 访问。
6. 部署成功后更新网站的状态、当前发布版本、发布记录及草稿同步版本。首次发布成功时把状态从 `unpublished` 改为 `published`。

远端不可达或网络错误时，API 将草稿业务 `status` 标记为 `error`，`syncStatus` 仍反映 sandbox 实际 Git 状态，并保留进行中的 `pendingOperation`（`pull` 或 `push`）与 `lastError`；远端恢复后可在 Admin 再次发起同一条 Pull 或 Push。

远端部署成功后、写入已发布内容查询表之前，API 会从当前 sandbox 执行 `reindexContentFromSandbox`，使发布快照与 Git 工作区内容集合一致（含 push 路径上的自动 merge 结果）。本地索引或发布事务失败时，API 保存远端标识、当前版本及错误信息，重试继续使用同一个远端网站。发布事务成功后，API 写入 `publish_records`，再上传到已启用的发布目标，见 [static-output.md](static-output.md)。

同一个网站的发布操作依次执行，后提交的修改必须结合其他用户已经成功发布的内容。`push` 可以直接发起，流程本身包含最新版本检查与合并。

## Agent 处理冲突

Pull、Push 与 `continue` 路径上的合并与冲突处理调用本机 Cursor Agent。命令由环境变量 `CURSOR_AGENT_COMMAND` 指定，默认执行 `cursor-agent`；Windows 可使用 `packages/sync/scripts/run-cursor-agent.ps1`。Agent 读取共同起始版本、sandbox 当前修改、网站最新发布版本、修改记录及相关代码，结合网站结构理解双方修改意图，完成合并。

验证包括构建、相关测试，以及页面引用、路由和配置的一致性检查。通过验证后，`pull` 保存 sandbox 的合并结果，`push` 继续远端部署。

双方存在无法同时满足的业务要求时，Agent 保留现场，说明具体冲突及需要用户决定的问题，等待用户决定后继续。处理冲突期间，线上网站继续使用当前已发布版本。管理后台在草稿状态为 `conflict` 时展示 Agent 返回的具体说明。

## 多用户协作示例

用户 A 和用户 B 都从 V1 创建草稿。用户 A 发布后，网站当前版本变为 V2。

用户 B 执行 `pull` 时，将 V2 与自己的修改合并，Agent 处理冲突并验证。用户 B 随后执行 `push`，部署成功后产生 V3。

用户 B 直接执行 `push` 时，同样需要读取 V2、合并修改、处理冲突并验证，然后才能发布。

## Legacy 数据库迁移与 sandbox 重试

从带 `tenant_id` 的旧库迁移到协作模型时，每个 legacy 站点对应一个确定性 `draft_id` 与 Git sandbox。迁移在单条数据库事务内锁定全部 legacy 业务表后读取快照，再构建或复用 sandbox，最后替换 schema 并写入协作表；任一步失败则事务回滚，legacy 表保持原样。

**首次构建 sandbox**（目录不存在时）：写入 source 与页面 JSON，本地 `runValidation` 执行 manifest build 生成 `public/`，提交 legacy 输入指纹；在 clean 工作区上通过 `verifySite` 核对 `public/` 与 source 一致后，用 `git update-ref refs/olps/migration-certified-head <HEAD>` 写入认证 commit。须已配置 `REMOTE_SERVICE_URL` 与 `REMOTE_SERVICE_TOKEN`；此阶段不调用远端 HTTP。构建或校验失败时不写入认证 ref。

**重试复用已有 sandbox**（目录已存在且 `skipIfPresent`）：不得覆盖用户文件。校验顺序为：输入指纹、settings、页面集合与内容、工作区 clean、存在且有效的 `refs/olps/migration-certified-head` 且与当前 HEAD 相同、 `verifySite` 只读核查。缺少认证 ref 或 ref 与 HEAD 不一致则拒绝，legacy 库与用户 sandbox 内容均保留。

用户仅在 `public/` 提交修改而 source 与指纹未变时，HEAD 与认证 ref 不一致或 `verifySite` 失败会拒绝迁移。迁移完成后再次调用 `migrateToCollaborationModel` 在 legacy 已替换时保持幂等；用户对 sandbox 的正常编辑由协作流程处理，不受迁移重试校验覆盖。

**运行迁移**：先 `npx tsx src/migration-bootstrap-users.ts`（在 `services/api` 目录），再配置 `MIGRATION_SITE_OWNERS` / `MIGRATION_KB_OWNERS` 并启动 `@olps/api`（legacy 库会在启动时迁移一次）。备份、映射示例与远端/Admin 联调见 [migration-rehearsal.md](migration-rehearsal.md)。

## 管理 API（Admin 已接入）

返回字段使用 camelCase。身份：`accessToken`、`user`（含 `account`、`name`）。`sites` 包含 `unpublished` 与 `published` 网站；`drafts` 为 sandbox 草稿且 `siteId` 必填。草稿状态组合见 [design/state-models.md](design/state-models.md)。冲突字段为 `conflictMessage`、`conflictSummary`、`validationLog`、`pendingOperation`。

- Pull/Push：`POST /api/drafts/:draftId/pull`、`POST /api/drafts/:draftId/push`
- 用户决定后继续：`POST /api/drafts/:draftId/continue`，body `{ userMessage }`。与 Pull/Push 相同：须为草稿所有者，且草稿已关联已发布网站时须同时为该网站的 `site_owners`；权限在 Agent、Git 与远端操作之前校验，未通过则返回 403 且不改变 sandbox 与远端发布 commit。
- 所有权：`GET/POST` 与 `DELETE .../owners/:userId` 于网站与草稿路径
- 无单页 `publish`；线上发布仅 Push

内容管理路径为 `/api/drafts/:draftId/pages/:pageId` 与 `/api/drafts/:draftId/collections/:collectionId/...`，同一内容在多个草稿中的 ID 保持一致。完整 API 见 [admin.md](admin.md)。

## 管理后台行为

- 登录/注册/退出：`/login`（本系统 `register` / `login`）。
- 我的网站：`/sites` 列出未发布与已发布网站及其草稿，新建网站或给已有网站新建草稿，管理成员。
- 选定草稿后进入仪表盘、页面、内容类型、媒体等模块；所有编辑 API 带当前草稿上下文。
- 发布网站：顶栏「发布网站」打开发布对话框，执行 Push，显示进度、冲突问题与 continue 表单；「同步最新内容」执行 Pull。顶栏左侧「查看网站」打开当前草稿整站预览；预览页 admin bar 可「返回后台」。顶栏右侧「切换网站」进入「我的网站」。界面不显示 commit 标识。
- 询盘、营销集成、报告、发布目标：按 [admin.md](admin.md) 第 6 节的范围规则读取数据。
