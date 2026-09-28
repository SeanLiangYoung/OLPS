import path from 'node:path'

export const SYNC_STORE_DIR = '.o'

export function resolveSyncIntermediateRoot(sandboxRoot: string): string {
  return path.join(path.resolve(sandboxRoot), SYNC_STORE_DIR)
}
