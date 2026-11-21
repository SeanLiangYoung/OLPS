import { createIndex } from 'pagefind'
import type { OutputFile } from './types.js'

function checkErrors(errors: string[]): void {
  if (errors.length) throw new Error(`Pagefind 索引失败：${errors.join('；')}`)
}

export async function buildSearchIndex(htmlFiles: OutputFile[]): Promise<OutputFile[]> {
  const created = await createIndex({ excludeSelectors: ['nav', 'header', 'footer', '[data-pagefind-ignore]'] })
  checkErrors(created.errors)
  if (!created.index) throw new Error('Pagefind 未创建索引')
  const index = created.index
  try {
    for (const file of htmlFiles) {
      if (!file.relativePath.endsWith('.html')) continue
      const result = await index.addHTMLFile({ sourcePath: file.relativePath.replace(/^public\//, ''), content: String(file.content) })
      checkErrors(result.errors)
    }
    const output = await index.getFiles()
    checkErrors(output.errors)
    return output.files.map(file => ({ relativePath: `pagefind/${file.path}`, content: Buffer.from(file.content) }))
  } finally {
    await index.deleteIndex()
  }
}
