# 用户、网站与协作发布

## 账号与网站生命周期

账号由系统的 `/api/auth/register`、`/api/auth/login` 和登录会话管理。一个用户可以拥有多个网站，一个网站可以包含多名成员；`site_owners` 与 `draft_owners` 分别保存网站和草稿成员。

`POST /api/sites` 在首次数据库事务中建立 `unpublished` 网站、第一份草稿、双方成员和网站知识库，事务完成后异步初始化默认内容。默认网站包含八种职责页面、英文和简体中文、新闻、产品、解决方案、一个主题及三个插件。`GET /api/sites/:siteId/initialization` 返回 `initializing`、`ready` 或 `failed`；重试复用原网站与草稿，并保留真实失败原因。

每份草稿始终拥有 `siteId`。`baseCommitId` 为同步基础版本，`headCommitId` 为已保存的 Git 版本，工作目录可以包含尚未提交的修改。`POST /api/drafts` 接收 `{siteId,name}`；已发布网站从当前发布版本建立新草稿，未发布网站使用当前账号可访问的已初始化草稿 Git 历史。

## 草稿互斥与索引

内容、设置、媒体、主题、插件、AI 和协作操作通过 `withDraftLock(draftId)` 协调同一草稿的写入。数据库事务校验成员和草稿状态；内容摘要通过带引号的 `If-Match` 检查。冲突期间普通编辑返回409，保留当前文件和同步现场。

`refreshContentIndexes` 依据网站目录重建结构化内容索引；调用者已经持有草稿锁时使用 `refreshContentIndexesUnlocked`。索引更新在数据库事务内完成，任何内容校验或约束失败会撤销该事务中的索引变更。创建草稿、迁移、Pull、Agent 合并和发布都调用索引刷新。

## 协作接口

- `POST /api/sites/:siteId/drafts/:draftId/pull`：读取远端当前成功版本，保存当前修改并执行三方合并。
- `GET /api/sites/:siteId/drafts/:draftId/synchronization`：读取 `{syncStatus,question}`。
- `POST /api/sites/:siteId/drafts/:draftId/continue`：请求 `{answer}`，依据运营回答继续同一操作。
- `POST /api/sites/:siteId/publish`：请求 `{draftId,requestKey}`，完成同步、验证、托管及其他目标发布。

共同原文、当前编辑内容和协作成员发布的内容参与三方合并。同一页面不同区块的修改可以同时保留；同一区块存在互斥业务要求时，由真实 Cursor Agent 提出需要运营选择的问题。运营回答后继续待处理的 Pull 或同一次发布。界面显示业务说明与处理要求，不显示 Git 版本标识和内部目录。

`CURSOR_AGENT_COMMAND` 指定本机 Cursor Agent，默认 `cursor-agent`。Agent 负责理解和编辑冲突内容，系统负责保存 Git 版本、执行完整构建和独立产物验证。

## 托管发布和恢复

发布操作使用草稿锁和网站发布锁，按网站串行执行，并检查当前发布基础版本。托管上传前持久保存候选版本与远端网站标识。网络响应丢失时，同一个 `requestKey` 查询真实远端当前版本，恢复已经成功的发布结果。

托管成功后，系统刷新草稿索引，从确切上传的 Git commit 加载模型，并记录不可变发布快照。网站的 `publishedCommitId` 对应该快照。公开询盘验证快照中的内容、语言和真实表单；草稿编辑不会改变当前公开快照。首次发布将网站改为 `published`，默认网址更新为实际托管地址，用户填写的自定义网址继续保留。

索引或数据库后处理失败时，发布记录和草稿保存错误，重试使用原发布请求和已经托管的确定版本。网络错误保留同步状态与待处理操作；恢复远端连接后可以重新执行。发布不会通过 Git 命令撤销用户内容。

## 其他发布目标

托管成功后处理启用的 FTP、FTPS、SFTP、S3 兼容、OSS、COS 目标。目标配置使用 AES-GCM 加密；每个目标维护本应用上传文件的 SHA-256 清单。内容相同的文件上传数量为零，只删除清单内已经不存在的文件。单个目标的错误单独保存，可以通过目标重试接口继续处理。

存在基础发布版本且只修改允许的媒体内容和上传元数据时，发布可以复用其他构建产物；其他内容变化执行完整构建。历史发布 ZIP 保留 `public/` 和 `server-config/`，通过 `GET /api/sites/:siteId/publish-records/:recordId/download.zip` 下载。历史版本不会通过目标重试覆盖当前版本。

## 迁移与历史业务

停止 API 后执行独立命令 `npm run upgrade -w @olps/api`。带 `sites.tenant_id` 的数据库首先执行 `migrateToCollaborationModel`：在数据库事务中锁定十张旧表，保留原业务字段和三条序列，通过 `cms-legacy-sandbox.ts` 准备确定性草稿 Git 目录。数据库事务失败时旧表保持原样。

命令调用 `migrateCmsRuntime` 执行 CMS 结构升级、`content-conversion.ts` 页面和媒体转换、`cms-migration.ts` 索引与知识资料处理，以及 `cms-legacy-inquiries.ts` 历史询盘转换。旧页面 UUID 和 HTML 正文保留，默认职责页面与缺少的语言内容分别补充。转换在独立目录构建并验证，成功后保存单个 Git 内容转换提交。完成记录写入 `cms_upgrade_state`，重复运行保持资料和完成记录不变。API 启动只检查升级完成状态。

旧地图密钥通过 Git 忽略目录中的加密恢复记录与数据库密文保存。恢复记录绑定网站、草稿和加密范围；即使转换提交已经存在，重新执行仍恢复尚未完成的凭据事务与索引。知识资料按网站归属，跨网站复制生成独立文档标识。历史询盘保留原始资料，并支持新版询盘列表和权限检查。

配置变量、专用数据库演练和数据比对见 [migration-rehearsal.md](migration-rehearsal.md)。

## 后台页面

`/sites` 管理网站及编辑版本，内容页面使用当前草稿上下文。`/publish` 显示托管、发布目标、通知、历史文件和协作确认。`/generate` 提供十类 AI 操作及可继续读取的 SSE 进度。`/inquiries` 分别显示公开询盘和预览询盘，`/reports` 提供当前和历史报告。

预览从当前草稿生成完整网站，通过短期凭据访问。预览询盘不创建邮件和营销转化任务。公开业务按网站读取，营销凭据在网站首次发布后提升到网站范围。范围规则见 [site-business-data-scope.md](site-business-data-scope.md)，预览访问见 [API 预览说明](../services/api/docs/preview-access.md)。
