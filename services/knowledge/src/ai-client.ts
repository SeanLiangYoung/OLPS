import OpenAI from 'openai'
import type { KnowledgeAiConfig } from './ai-config.js'

const MAX_OUTPUT_TOKENS = 8192

export async function completeJson(
  ai: KnowledgeAiConfig,
  input: { system: string; user: string },
): Promise<Record<string, unknown>> {
  const client = new OpenAI({
    baseURL: ai.baseUrl,
    apiKey: ai.apiKey,
    maxRetries: 0,
  })
  const completion = await client.chat.completions.create({
    model: ai.model,
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