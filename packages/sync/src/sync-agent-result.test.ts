import { describe, expect, it } from 'vitest'
import { parseAgentResultProtocol } from './agent-result.js'

describe('parseAgentResultProtocol', () => {
  it('解析标准 JSON 协议行', () => {
    const text = 'done\nOLPS_AGENT_RESULT_JSON={"status":"resolved","message":""}'
    expect(parseAgentResultProtocol(text)?.status).toBe('resolved')
  })

  it('非标准 JSON 协议行无法解析', () => {
    const text = 'OLPS_AGENT_RESULT_JSON={status:resolved,message:"}'
    expect(parseAgentResultProtocol(text)).toBeNull()
  })

  it('从多行输出中取最后一条有效协议', () => {
    const text = [
      'OLPS_AGENT_RESULT_JSON={broken',
      'OLPS_AGENT_RESULT_JSON={"status":"needs_user","message":"选 A 还是 B"}',
    ].join('\n')
    expect(parseAgentResultProtocol(text)?.status).toBe('needs_user')
  })
})
