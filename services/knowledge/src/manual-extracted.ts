import fs from 'node:fs/promises'
import path from 'node:path'

export type ExtractedTextRecord = {
  sourcePath: string
  text: string
  importId: string
  fingerprint: string
}

function extractedRelativePathForSource(sourcePath: string): string {
  return `.olps-knowledge/extracted/${sourcePath}.json`
}

export async function writeExtractedTextRecord(
  projectDir: string,
  sourcePath: string,
  record: ExtractedTextRecord,
): Promise<void> {
  const relativePath = extractedRelativePathForSource(sourcePath)
  const abs = path.join(projectDir, ...relativePath.split('/'))
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}