import fs from 'node:fs/promises'
import path from 'node:path'

export async function listRemoteSiteIdsFromDataRoot(dataRoot: string): Promise<Set<string>> {
  const sitesDir = path.join(dataRoot, 'sites')
  let entries: string[] = []
  try {
    entries = await fs.readdir(sitesDir)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return new Set()
    }
    throw err
  }
  const ids = new Set<string>()
  for (const name of entries) {
    if (!name.endsWith('.json')) {
      continue
    }
    ids.add(name.slice(0, -'.json'.length))
  }
  return ids
}

export function newRemoteSiteIdsSince(
  before: Set<string>,
  after: Set<string>,
): Set<string> {
  const added = new Set<string>()
  for (const id of after) {
    if (!before.has(id)) {
      added.add(id)
    }
  }
  return added
}

export async function assertRemoteSiteExistsViaHttp(
  remoteSiteId: string,
  remoteServiceUrl: string,
  remoteServiceToken: string,
): Promise<void> {
  const base = remoteServiceUrl.replace(/\/+$/, '')
  const response = await fetch(`${base}/api/remote/sites/${encodeURIComponent(remoteSiteId)}`, {
    headers: { Authorization: `Bearer ${remoteServiceToken}` },
  })
  if (response.status !== 200) {
    const text = await response.text()
    throw new Error(
      `远端站点记录不存在或不可读 remoteSiteId=${remoteSiteId} status=${response.status} body=${text}`,
    )
  }
}
