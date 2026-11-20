import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.join(__dirname, '..', 'test-fixtures', 'sites', 'full-site')
const outFile = path.join(__dirname, '..', 'src', 'test-support', 'full-site-files.json')

async function walk(directory, relativePrefix, files) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.gitkeep') {
      continue
    }
    const absolute = path.join(directory, entry.name)
    const relative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await walk(absolute, relative, files)
      continue
    }
    if (entry.isFile()) {
      const content = await fs.readFile(absolute)
      const isText = /\.(json|liquid|css|js|mjs|html|md|txt|svg)$/i.test(entry.name)
      if (!isText) {
        continue
      }
      files[relative.replace(/\\/g, '/')] = content.toString('utf8')
    }
  }
}

const files = {}
await walk(fixtureRoot, '', files)
await fs.writeFile(outFile, `${JSON.stringify(files, null, 2)}\n`, 'utf8')
console.log(`wrote ${Object.keys(files).length} files to ${outFile}`)
