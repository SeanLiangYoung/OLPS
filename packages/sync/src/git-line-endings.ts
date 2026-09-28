import { gitOrThrow } from './git-exec.js'

export function applyRepoLocalLineEndingPolicy(repoPath: string): void {
  gitOrThrow(repoPath, ['config', 'core.autocrlf', 'false'])
  gitOrThrow(repoPath, ['config', 'core.eol', 'lf'])
}
