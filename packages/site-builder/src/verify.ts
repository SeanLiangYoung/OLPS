import { planPublicOutputs } from './build.js'
import { verifyPublicMatchesPlan } from './write-public.js'

/**
 * 校验 public/ 与当前源码构建计划一致。
 * W4-T3 将扩展为完整 site-verify 规则。
 */
export async function verifySite(workspacePath: string): Promise<void> {
  const files = await planPublicOutputs(workspacePath)
  await verifyPublicMatchesPlan(workspacePath, files)
}
