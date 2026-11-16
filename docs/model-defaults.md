# 模型与生成默认

> 页面生成、引导规划、文案、翻译、报告等业务模型使用 **MiniMax M3**。
> 必须可配置，不要固定到换不了。

## 默认

| 用途 | 默认 |
|------|------|
| 页面生成、引导规划、文案、翻译、报告等 | **MiniMax-M3** |

配置 `MINIMAX_API_KEY`、`MINIMAX_BASE_URL` 和 `MINIMAX_MODEL`。默认服务地址为 `https://api.minimax.cn/v1`，国际账号可以使用 `https://api.minimax.io/v1`。具体模型名称由 `MINIMAX_MODEL` 决定，默认 `MiniMax-M3`。

## 要求

1. 站点或部署环境能改默认模型，不必改代码。  
2. 服务端使用 OpenAI SDK 的兼容接口及结构化工具调用。响应通过 Zod、HTML 和 Guide 校验后写入草稿。
3. 模型请求失败时任务保存失败信息，现有页面内容保持原样。任务保存知识文档快照、来源 hash、模型名称及 token usage。
