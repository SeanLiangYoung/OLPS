# 模型与生成默认

> 内容生成、修改与翻译通过 OpenAI 兼容接口调用模型，默认使用 DeepSeek 官方接口与 `deepseek-v4-pro`。  
> 必须可配置，不要固定到换不了。

## 默认

| 配置项（根目录 `.env`） | 默认 | 说明 |
|------|------|------|
| `AI_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容接口地址 |
| `AI_API_KEY` | 无，必填 | 调用 AI 时缺失则直接报错 |
| `AI_MODEL` | `deepseek-v4-pro` | 模型名；可换成 `deepseek-flash` 或其它兼容模型 |

## 调用方式

- `services/api/src/ai-client.ts` 使用 `openai` npm 包的 `chat.completions.create`，`response_format` 为 `json_object`，提示词里给出 JSON 格式示例；
- `max_tokens` 为 32768（思考模式下包含思考内容与最终输出）；
- 不自动重试；模型返回非 `stop` 结束、空内容或非 JSON 对象时直接报错，Job 标为 `failed`；
- 每次调用输出一个 JSON 对象：结构树、区块大纲、单个区块的 `props`、翻译结果或搜索引擎信息。各操作的输入、输出与写作规则见 [ai-generation.md](ai-generation.md)。

## 要求

1. 站点或部署环境能改默认模型，不必改代码。  
2. 模型失败时不使用模板顶替。
