# 错误处理

全部代码在出错的位置就地崩溃。原始错误原样抛出。

## 规则

1. 调用失败就让它失败。
2. 保留上游错误的原文、类型和调用位置。日志也记这份原始错误。
3. 配置缺失、数据库连不上、鉴权材料不对、生成前提不成立，进程在该位置终止。
4. 引导图不合法、未选择知识库、未选择当前草稿，在进入下一步之前用明确条件拒绝，并带上当时的原因。

## 旧代码里的捕获和 fallback

迁入或改写旧 LPS 代码时，按下面处理：

- 捕获或 fallback 里面如果有必须保留的业务判断（例如「未选择草稿则要求先选择」「跳转目标不存在则拒绝保存」），把这段判断写成普通的条件分支，放在正常流程里。
- 只为接住异常、改写文案、换成另一个错误码、或在失败后改走别的路径而写的捕获，删除。

正常流程里的条件判断可以保留。用 try-catch 把失败变成空结果、默认值或另一条悄悄继续的路径，删除。

## Pull / Push 与远端

- **远端 HTTP 传输失败**（连接拒绝、超时、`fetch failed` 等）：Pull 与 Push 在 API 层识别为传输错误，返回 HTTP 503 与可读 `lastError` 文案。草稿业务 `status` 为 `error`，`syncStatus` 保存 sandbox 上 `SyncWorkspace.getState().status` 的实际值（例如 `clean`、`dirty`），保留对应的 `pendingOperation`（`pull` 或 `push`）与当前 Git `head`/`base`，sandbox 文件与 Git 内容不变。远端与管理 API 配置恢复一致后，用户再次发起同一条 Pull 或 Push 即可重试。
- **远端业务拒绝**（校验失败、409 版本冲突等）：由 `@olps/sync` 返回具体 `syncStatus`（如 `validation_failed`、`dirty`）；冲突与校验问题走 Agent 或用户 `continue`，不在 API 层吞掉错误。
- **Cursor Agent 失败**：合并或验证未通过时草稿进入 `conflict` / `validation_failed` 等状态，保留日志字段供 Admin 展示；修复 sandbox 或补充用户说明后 Pull、Push 或 `continue` 继续流程。
