import fs from 'node:fs/promises'
import path from 'node:path'
import { planPublicOutputs } from './build.js'
import { writePublicOutputs } from './write-public.js'
import type { BuildOptions } from './types.js'

export async function buildPreview(workspacePath: string, options: BuildOptions & { outputDirectory?: string } = {}): Promise<void> {
  const files = await planPublicOutputs(workspacePath, 'preview',options)
  const outputRoot = options.outputDirectory ? path.resolve(options.outputDirectory) : workspacePath
  await fs.mkdir(outputRoot, { recursive: true })
  await writePublicOutputs(outputRoot, files)
}
