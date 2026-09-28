export type AgentProtocolStatus = 'resolved' | 'needs_user' | 'failed'

export type ParsedAgentResult = {
  status: AgentProtocolStatus
  message: string
}

const MARKER = 'OLPS_AGENT_RESULT_JSON='

export function parseAgentResultProtocol(agentText: string): ParsedAgentResult | null {
  const lines = agentText.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    const idx = line.indexOf(MARKER)
    if (idx === -1) {
      continue
    }
    const jsonPart = line.slice(idx + MARKER.length).trim()
    let parsed: { status?: string; message?: string }
    try {
      parsed = JSON.parse(jsonPart) as { status?: string; message?: string }
    } catch {
      continue
    }
    if (
      parsed.status === 'resolved' ||
      parsed.status === 'needs_user' ||
      parsed.status === 'failed'
    ) {
      return {
        status: parsed.status,
        message: typeof parsed.message === 'string' ? parsed.message : '',
      }
    }
  }
  return null
}
