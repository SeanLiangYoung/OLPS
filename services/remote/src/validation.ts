const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function assertValidRemoteSiteId(remoteSiteId: string): void {
  if (!UUID_RE.test(remoteSiteId)) {
    throw new Error(`非法 remoteSiteId: ${remoteSiteId}`)
  }
}

export function assertSafePublicRelativePath(relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`非法公开路径: 不允许绝对路径 ${relativePath}`)
  }
  for (const segment of normalized.split('/')) {
    if (segment === '..') {
      throw new Error(`非法公开路径: 不允许 .. 片段 ${relativePath}`)
    }
  }
  if (normalized.includes('.git')) {
    throw new Error(`非法公开路径: 不允许访问 .git ${relativePath}`)
  }
}

export function assertSafeGitRef(ref: string): void {
  if (ref.startsWith('-')) {
    throw new Error(`非法 Git ref: 疑似参数注入 ${ref}`)
  }
  if (ref.includes('\0')) {
    throw new Error(`非法 Git ref: ${ref}`)
  }
  if (!/^[A-Za-z0-9._/^-]+$/.test(ref)) {
    throw new Error(`非法 Git ref: ${ref}`)
  }
}

export function assertSafeGitCommitId(commitId: string): void {
  if (!/^[0-9a-f]{40}$/i.test(commitId)) {
    throw new Error(`非法 commitId: ${commitId}`)
  }
}
