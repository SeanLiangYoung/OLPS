import { spawnSync } from 'node:child_process'

export function git(cwd: string, args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) {
    throw result.error
  }
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

export function gitOrThrow(cwd: string, args: string[]): string {
  const { stdout, stderr, status } = git(cwd, args)
  if (status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败 (${status}): ${stderr || stdout}`)
  }
  return stdout.trim()
}
