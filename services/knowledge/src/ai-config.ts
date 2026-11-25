export type KnowledgeAiConfig = {
  apiKey: string
  baseUrl: string
  model: string
}

function readNonEmpty(env: NodeJS.ProcessEnv, names: readonly string[], fallback?: string): string {
  for (const name of names) {
    const trimmed = env[name]?.trim()
    if (trimmed) {
      return trimmed
    }
  }
  if (fallback !== undefined) {
    return fallback
  }
  return ''
}

export function loadKnowledgeAiConfig(env: NodeJS.ProcessEnv): KnowledgeAiConfig {
  const apiKey = readNonEmpty(env, ['KNOWLEDGE_AI_API_KEY', 'AI_API_KEY'])
  const baseUrl = readNonEmpty(env, ['KNOWLEDGE_AI_BASE_URL', 'AI_BASE_URL'], 'https://api.deepseek.com')
  const model = readNonEmpty(env, ['KNOWLEDGE_AI_MODEL', 'AI_MODEL'], 'deepseek-v4-pro')
  return { apiKey, baseUrl, model }
}

export function requireKnowledgeAiConfig(env: NodeJS.ProcessEnv): KnowledgeAiConfig {
  const config = loadKnowledgeAiConfig(env)
  if (!config.apiKey) {
    throw new Error('必须设置 KNOWLEDGE_AI_API_KEY 或 AI_API_KEY')
  }
  return config
}