import fs from 'node:fs/promises'
import path from 'node:path'
import { planPublicOutputs } from './build.js'
import { writePublicOutputs } from './write-public.js'

export async function buildPreview(workspacePath: string, options: { outputDirectory?: string } = {}): Promise<void> {
  const files = await planPublicOutputs(workspacePath, 'preview')
  const outputRoot = options.outputDirectory ? path.resolve(options.outputDirectory) : workspacePath
  await fs.mkdir(outputRoot, { recursive: true })
  await writePublicOutputs(outputRoot, files)
}
