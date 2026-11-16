import OpenAI from 'openai'
import { z } from 'zod'

export function modelConfiguration() {
  const apiKey = process.env.MINIMAX_API_KEY?.trim()
  if (!apiKey) throw new Error('缺少 MINIMAX_API_KEY，请在服务端配置 MiniMax 凭据')
  const baseURL = process.env.MINIMAX_BASE_URL?.trim() || 'https://api.minimax.cn/v1'
  const url = new URL(baseURL)
  if (url.protocol !== 'https:') throw new Error('MiniMax 服务地址必须使用 HTTPS')
  return { apiKey, baseURL, model: process.env.MINIMAX_MODEL?.trim() || 'MiniMax-M3' }
}

export async function requestStructuredModel<T extends z.ZodType>(input: {
  schema: T
  name: string
  instruction: string
  content: unknown
}): Promise<{ value: z.infer<T>; evidence: { provider: string; model: string; responseId: string; usage: unknown; completedAt: string } }> {
  const config = modelConfiguration()
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: 0, timeout: 180_000 })
  const response = await client.chat.completions.create({
    model: config.model,
    max_completion_tokens: 32768,
    messages: [{ role: 'system', content: input.instruction }, { role: 'user', content: JSON.stringify(input.content) }],
    tools: [{ type: 'function', function: { name: input.name, description: '提交已完成并检查的数据', parameters: z.toJSONSchema(input.schema) } }],
    tool_choice: { type: 'function', function: { name: input.name } },
  })
  const choice = response.choices[0]
  if (!choice || choice.finish_reason === 'length') throw new Error('模型输出未完成，未保存页面')
  const calls = choice.message.tool_calls
  if (calls?.length !== 1 || calls[0].type !== 'function' || calls[0].function.name !== input.name) throw new Error('模型未按要求提交结构化结果')
  return {
    value: input.schema.parse(JSON.parse(calls[0].function.arguments)),
    evidence: { provider: 'minimax', model: response.model, responseId: response.id, usage: response.usage, completedAt: new Date().toISOString() },
  }
}
