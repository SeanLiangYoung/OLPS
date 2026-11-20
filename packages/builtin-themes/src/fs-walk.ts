import fs from 'node:fs/promises'
import path from 'node:path'

export async function walkTextFiles(
  rootDirectory: string,
  relativePrefix = '',
): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.gitkeep') {
      continue
    }
    const absolute = path.join(rootDirectory, entry.name)
    const relative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      Object.assign(files, await walkTextFiles(absolute, relative))
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    if (!/\.(json|liquid|css|js|mjs|html|md|txt|svg)$/i.test(entry.name)) {
      continue
    }
    files[relative.replace(/\\/g, '/')] = await fs.readFile(absolute, 'utf8')
  }
  return files
}

export async function listSectionDirectories(themeRoot: string): Promise<string[]> {
  const sectionsRoot = path.join(themeRoot, 'sections')
  const entries = await fs.readdir(sectionsRoot, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}
