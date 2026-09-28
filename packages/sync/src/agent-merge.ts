import path from 'node:path'
import { git, gitOrThrow } from './git-exec.js'
import { runCursorAgent } from './cursor-agent-runner.js'
import { runWorkspaceValidation, assertWorkspaceConflictMarkersCleared } from './validation.js'
import { parseAgentResultProtocol } from './agent-result.js'
import { gitMergeInProgress, gitUnmergedPaths } from './git-bundle.js'
import type { AgentContinueInput, DraftSyncState, SyncBuildConfig } from './types.js'

function buildConflictStageDigest(workspacePath: string, conflictFiles: string[]): string {
  if (conflictFiles.length === 0) {
    return '（无未合并路径，请 git status 检查）'
  }
  const blocks: string[] = []
  for (const file of conflictFiles) {
    const lines: string[] = [`### ${file}`]
    const stages: Array<{ label: string; stage: number }> = [
      { label: 'base（共同祖先 :1）', stage: 1 },
      { label: 'ours（当前 HEAD :2）', stage: 2 },
      { label: 'theirs（MERGE_HEAD :3）', stage: 3 },
    ]
    for (const { label, stage } of stages) {
      const result = git(workspacePath, ['show', `:${stage}:${file}`])
      if (result.status === 0) {
        lines.push(`${label}:\n${result.stdout.slice(0, 8000)}`)
      } else {
        lines.push(`${label}: （git show 不可用: ${result.stderr.trim() || result.stdout.trim()}）`)
      }
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

function buildMergePrompt(input: {
  workspacePath: string
  conflictFiles: string[]
  userMessage?: string
}): string {
  const files = input.conflictFiles.join(', ')
  const stageDigest = buildConflictStageDigest(input.workspacePath, input.conflictFiles)
  const userPart = input.userMessage
    ? `\n用户补充说明：\n${input.userMessage}\n`
    : ''
  return `你在 Git 工作目录 ${input.workspacePath} 中处理三方合并冲突。
冲突文件：${files || '（请检查 git status）'}

必须先基于 Git 索引阶段做三方分析（不要只比较 HEAD 与 MERGE_HEAD 提交信息而忽略共同祖先）：
对每个冲突文件在 shell 中执行并理解：
  git show :1:<path>   # base / 共同祖先
  git show :2:<path>   # ours / 当前分支
  git show :3:<path>   # theirs / 待合并提交
逐字段识别：各方相对 base 改变了哪些字段；不同字段的改动通常可同时保留；仅当同一字段在 ours 与 theirs 相对 base 的意图互斥时才 needs_user。

以下为当前索引阶段内容（供分析，仍应用 git show 自行核对）：
${stageDigest}

要求：保留双方可以共存的修改；仅编辑工作区文件清除冲突标记，禁止执行 git add、git commit 或任何 Git 提交。
仅当存在无法同时满足的业务要求时，在回复末尾单独一行输出：
OLPS_AGENT_RESULT_JSON={"status":"needs_user","message":"需要用户决定：<具体问题>"}
不要只用文件名代替业务问题；needs_user 必须说明相对 base 冲突的具体字段或业务规则。
若所有冲突文件已无冲突标记且 source 下 JSON 合法、public 与 source 一致，回复最后一行必须单独一行、整行只包含下面这一行（逐字符复制，含英文双引号，禁止 JS 对象字面量或 markdown）：
OLPS_AGENT_RESULT_JSON={"status":"resolved","message":""}${userPart}`
}

export async function finalizeAgentResolvedMerge(input: {
  workspacePath: string
  build?: SyncBuildConfig
  conflictFiles: string[]
}): Promise<{ ok: true; validationLog: string } | { ok: false; status: 'merge_conflict' | 'validation_failed'; message: string; validationLog?: string }> {
  try {
    await assertWorkspaceConflictMarkersCleared(input.workspacePath, input.conflictFiles)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 'merge_conflict', message }
  }

  const validation = await runWorkspaceValidation(input.workspacePath, input.build)
  if (!validation.ok) {
    return { ok: false, status: 'validation_failed', message: validation.log, validationLog: validation.log }
  }

  gitOrThrow(input.workspacePath, ['add', '-A'])
  const afterStage = gitUnmergedPaths(input.workspacePath)
  if (afterStage.length > 0) {
    return {
      ok: false,
      status: 'merge_conflict',
      message: `暂存后仍有未合并项: ${afterStage.join(', ')}`,
    }
  }

  commitMergeIfNeeded(input.workspacePath)
  return { ok: true, validationLog: validation.log }
}

function commitMergeIfNeeded(workspacePath: string): void {
  if (gitMergeInProgress(workspacePath)) {
    gitOrThrow(workspacePath, ['commit', '-m', 'merge: agent resolved conflicts'])
    return
  }
  const porcelain = git(workspacePath, ['status', '--porcelain']).stdout.trim()
  if (porcelain) {
    gitOrThrow(workspacePath, ['add', '-A'])
    gitOrThrow(workspacePath, ['commit', '-m', 'merge: post-validation snapshot'])
  }
}

export async function resolveConflictsWithAgent(input: {
  workspacePath: string
  draftId: string
  intermediateRoot: string
  build?: SyncBuildConfig
  state: DraftSyncState
  userMessage?: string
}): Promise<DraftSyncState> {
  const headBefore = gitOrThrow(input.workspacePath, ['rev-parse', 'HEAD'])
  const conflictFiles = gitUnmergedPaths(input.workspacePath)
  const logDir = path.join(input.intermediateRoot, 'agent-logs', input.draftId)
  const prompt = buildMergePrompt({
    workspacePath: input.workspacePath,
    conflictFiles,
    userMessage: input.userMessage,
  })
  const agentResult = await runCursorAgent({
    cwd: input.workspacePath,
    prompt,
    logDir,
  })

  const agentText = `${agentResult.stdout}\n${agentResult.stderr}`
  if (agentResult.timedOut) {
    return {
      ...input.state,
      status: 'merge_conflict',
      agentFailureLog: agentResult.logPath,
      validationLog: agentText.slice(-8000),
      conflictSummary: input.state.conflictSummary ?? 'Agent 调用超时，已终止子进程树',
    }
  }
  if (agentResult.exitCode !== 0) {
    return {
      ...input.state,
      status: 'merge_conflict',
      agentFailureLog: agentResult.logPath,
      validationLog: agentText.slice(-8000),
      conflictSummary: input.state.conflictSummary ?? `Agent 退出码 ${agentResult.exitCode}`,
    }
  }

  const headAfterAgent = gitOrThrow(input.workspacePath, ['rev-parse', 'HEAD'])
  if (headAfterAgent !== headBefore) {
    return {
      ...input.state,
      status: 'merge_conflict',
      conflictSummary: 'Agent 不得自行 git commit；请保留 MERGE_HEAD 后重试',
      validationLog: agentResult.logPath,
      agentFailureLog: agentResult.logPath,
    }
  }

  const protocol = parseAgentResultProtocol(agentText)
  if (protocol?.status === 'needs_user') {
    return {
      ...input.state,
      status: 'awaiting_user',
      conflictSummary: protocol.message || agentText.slice(-4000),
      validationLog: agentResult.logPath,
      agentFailureLog: undefined,
    }
  }
  if (protocol?.status === 'failed') {
    return {
      ...input.state,
      status: 'validation_failed',
      validationLog: protocol.message || agentText.slice(-4000),
      agentFailureLog: agentResult.logPath,
    }
  }
  if (!protocol || protocol.status !== 'resolved') {
    return {
      ...input.state,
      status: 'awaiting_user',
      conflictSummary:
        protocol?.message || 'Agent 输出缺少 status=resolved 的 OLPS_AGENT_RESULT_JSON 协议行',
      validationLog: agentResult.logPath,
    }
  }

  const finalized = await finalizeAgentResolvedMerge({
    workspacePath: input.workspacePath,
    build: input.build,
    conflictFiles,
  })
  if (!finalized.ok) {
    return {
      ...input.state,
      status: finalized.status,
      conflictSummary: finalized.message,
      validationLog: finalized.validationLog ?? agentResult.logPath,
      agentFailureLog: finalized.status === 'merge_conflict' ? agentResult.logPath : undefined,
    }
  }

  const head = gitOrThrow(input.workspacePath, ['rev-parse', 'HEAD'])
  let nextBase = input.state.baseCommitId
  if (input.state.pendingIncomingCommitId) {
    nextBase = input.state.pendingIncomingCommitId
  }
  return {
    ...input.state,
    headCommitId: head,
    baseCommitId: nextBase,
    status: 'clean',
    conflictSummary: undefined,
    validationLog: finalized.validationLog,
    pendingIncomingCommitId: null,
    agentFailureLog: undefined,
  }
}

export async function continueAfterUser(
  input: AgentContinueInput & {
    workspacePath: string
    draftId: string
    intermediateRoot: string
    build?: SyncBuildConfig
    state: DraftSyncState
  },
): Promise<DraftSyncState> {
  return resolveConflictsWithAgent({
    workspacePath: input.workspacePath,
    draftId: input.draftId,
    intermediateRoot: input.intermediateRoot,
    build: input.build,
    state: { ...input.state, status: 'awaiting_user' },
    userMessage: input.userMessage,
  })
}
