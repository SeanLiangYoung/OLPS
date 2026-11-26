import fs from 'node:fs/promises'
import path from 'node:path'

export type ImportItemStatus =
  | 'pending'
  | 'extracting'
  | 'analyzing'
  | 'writing'
  | 'succeeded'
  | 'failed'
  | 'skipped_duplicate'
  | 'skipped_unsupported'

export type ImportItem = {
  sourcePath: string
  status: ImportItemStatus
  fingerprint: string | null
  kind: string | null
  wikiPath: string | null
  aliasOfWikiPath: string | null
  error: string | null
  updatedAt: string
}

export type ImportItemsFile = {
  importId: string
  items: ImportItem[]
}

function itemsFilePath(projectDir: string, importId: string): string {
  return path.join(projectDir, '.olps-knowledge', 'imports', importId, 'items.json')
}

function nowIso(): string {
  return new Date().toISOString()
}

export function createPendingImportItems(importId: string, sourcePaths: string[]): ImportItemsFile {
  const updatedAt = nowIso()
  return {
    importId,
    items: sourcePaths.map((sourcePath) => ({
      sourcePath,
      status: 'pending',
      fingerprint: null,
      kind: null,
      wikiPath: null,
      aliasOfWikiPath: null,
      error: null,
      updatedAt,
    })),
  }
}

export async function writeImportItems(projectDir: string, file: ImportItemsFile): Promise<void> {
  const abs = itemsFilePath(projectDir, file.importId)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  const payload = `${JSON.stringify(file, null, 2)}\n`
  const tempPath = `${abs}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, payload, 'utf8')
  try {
    await fs.rename(tempPath, abs)
  } catch {
    await fs.rm(abs, { force: true })
    await fs.rename(tempPath, abs)
  }
}

export async function readImportItems(projectDir: string, importId: string): Promise<ImportItemsFile | null> {
  const abs = itemsFilePath(projectDir, importId)
  let lastSyntax: SyntaxError | null = null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let raw: string
    try {
      raw = await fs.readFile(abs, 'utf8')
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        return null
      }
      throw err
    }
    try {
      const parsed = JSON.parse(raw) as ImportItemsFile
      if (!parsed || parsed.importId !== importId || !Array.isArray(parsed.items)) {
        throw new Error(`items.json 无效: ${importId}`)
      }
      return parsed
    } catch (err) {
      if (err instanceof SyntaxError) {
        lastSyntax = err
        await new Promise((resolve) => setTimeout(resolve, 5))
        continue
      }
      throw err
    }
  }
  throw lastSyntax ?? new Error(`items.json 无法读取: ${importId}`)
}

export async function ensureImportItems(
  projectDir: string,
  importId: string,
  sourcePaths: string[],
): Promise<ImportItemsFile> {
  const existing = await readImportItems(projectDir, importId)
  if (existing) {
    return existing
  }
  const created = createPendingImportItems(importId, sourcePaths)
  await writeImportItems(projectDir, created)
  return created
}

export function findImportItem(file: ImportItemsFile, sourcePath: string): ImportItem | undefined {
  return file.items.find((item) => item.sourcePath === sourcePath)
}

export async function patchImportItem(
  projectDir: string,
  importId: string,
  sourcePath: string,
  patch: Partial<Omit<ImportItem, 'sourcePath' | 'updatedAt'>>,
): Promise<ImportItem> {
  const file = await readImportItems(projectDir, importId)
  if (!file) {
    throw new Error(`items.json 不存在: ${importId}`)
  }
  const item = findImportItem(file, sourcePath)
  if (!item) {
    throw new Error(`items 中缺少来源: ${sourcePath}`)
  }
  Object.assign(item, patch, { updatedAt: nowIso() })
  await writeImportItems(projectDir, file)
  return item
}

export function summarizeImportItems(items: ImportItem[]): {
  itemSucceeded: number
  itemFailed: number
  itemSkippedDuplicate: number
  itemSkippedUnsupported: number
  itemPending: number
} {
  let itemSucceeded = 0
  let itemFailed = 0
  let itemSkippedDuplicate = 0
  let itemSkippedUnsupported = 0
  let itemPending = 0
  for (const item of items) {
    switch (item.status) {
      case 'succeeded':
        itemSucceeded += 1
        break
      case 'failed':
        itemFailed += 1
        break
      case 'skipped_duplicate':
        itemSkippedDuplicate += 1
        break
      case 'skipped_unsupported':
        itemSkippedUnsupported += 1
        break
      default:
        itemPending += 1
        break
    }
  }
  return {
    itemSucceeded,
    itemFailed,
    itemSkippedDuplicate,
    itemSkippedUnsupported,
    itemPending,
  }
}

export function listFailedImportItemPaths(items: ImportItem[], sourcePaths?: string[]): string[] {
  const allowed = sourcePaths ? new Set(sourcePaths) : null
  return items
    .filter((item) => item.status === 'failed' && (!allowed || allowed.has(item.sourcePath)))
    .map((item) => item.sourcePath)
}

export function isTerminalImportItemStatus(status: ImportItemStatus): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'skipped_duplicate' ||
    status === 'skipped_unsupported'
  )
}
