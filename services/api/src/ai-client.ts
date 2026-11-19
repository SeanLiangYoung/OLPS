import OpenAI from 'openai'
import { appConfig } from './config.js'

// 思考模式下 max_tokens 同时包含思考内容与最终输出
const MAX_OUTPUT_TOKENS = 32768

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: appConfig.aiBaseUrl,
      apiKey: appConfig.aiApiKey,
      maxRetries: 0,
    })
  }
  return client
}

/** 调用模型并要求返回 JSON 对象；输出被截断、为空或不是 JSON 时直接抛出。 */
export async function completeJson(input: { system: string; user: string }): Promise<Record<string, unknown>> {
  const completion = await getClient().chat.completions.create({
    model: appConfig.aiModel,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
    response_format: { type: 'json_object' },
    max_tokens: MAX_OUTPUT_TOKENS,
  })
  const choice = completion.choices[0]
  if (!choice) {
    throw new Error('AI 未返回任何结果')
  }
  if (choice.finish_reason !== 'stop') {
    throw new Error(`AI 输出未正常结束: finish_reason=${choice.finish_reason}`)
  }
  const content = choice.message.content?.trim()
  if (!content) {
    throw new Error('AI 返回内容为空')
  }
  const parsed: unknown = JSON.parse(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI 返回的 JSON 不是对象')
  }
  return parsed as Record<string, unknown>
}
