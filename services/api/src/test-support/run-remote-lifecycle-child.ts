import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startRemoteHttpServiceFromWorktree } from './remote-process.js'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const scenario = process.env.REMOTE_LIFECYCLE_SCENARIO ?? 'success'

async function run(): Promise<void> {
  if (scenario === 'fail-start') {
    process.env.REMOTE_WORKTREE_ROOT = path.join(
      apiRoot,
      '.intermediate',
      'missing-remote-worktree-for-lifecycle',
    )
    try {
      await startRemoteHttpServiceFromWorktree()
      throw new Error('fail-start 场景下远端启动应当失败')
    } catch {
      return
    }
  }

  const remote = await startRemoteHttpServiceFromWorktree()
  await remote.stop()
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
