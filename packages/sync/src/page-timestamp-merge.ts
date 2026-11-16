import fs from 'node:fs/promises'
import path from 'node:path'
import { git, gitOrThrow } from './git-exec.js'
import { gitUnmergedPaths } from './git-bundle.js'
import { assertWorkspaceWritePath } from './path-guard.js'

export async function mergePageTimestamps(workspacePath: string, intermediateRoot: string): Promise<void> {
  for (const file of gitUnmergedPaths(workspacePath)) {
    if (!/^source\/pages\/[^/]+\.json$/.test(file)) continue
    const stages = [2, 1, 3].map(stage => git(workspacePath, ['show', `:${stage}:${file}`]))
    if (stages.some(stage => stage.status !== 0)) continue
    const pages = stages.map(stage => JSON.parse(stage.stdout) as Record<string, unknown>)
    if (pages.some(page => typeof page.updatedAt !== 'string' || !Number.isFinite(Date.parse(page.updatedAt)))) continue
    await fs.mkdir(intermediateRoot, { recursive: true })
    const directory = await fs.mkdtemp(path.join(intermediateRoot, 'page-time-merge-'))
    try {
      const files = ['ours.json', 'base.json', 'theirs.json'].map(name => path.join(directory, name))
      for (let index = 0; index < pages.length; index++) {
        const { updatedAt: _updatedAt, ...content } = pages[index]!
        await fs.writeFile(files[index]!, JSON.stringify(content, null, 2) + '\n')
      }
      const merged = git(workspacePath, ['merge-file', '--stdout', files[0]!, files[1]!, files[2]!])
      if (merged.status > 0 && merged.status <= 127) continue
      if (merged.status !== 0) throw new Error(`页面三方合并失败：${merged.stderr}`)
      const content = JSON.parse(merged.stdout) as Record<string, unknown>
      const updatedAt = new Date(Math.max(...pages.map(page => Date.parse(page.updatedAt as string)))).toISOString()
      const target = await assertWorkspaceWritePath(workspacePath, file)
      await fs.writeFile(target, JSON.stringify({ ...content, updatedAt }, null, 2) + '\n')
      gitOrThrow(workspacePath, ['add', '--', file])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
}
