import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const settingsPath = path.join(root, 'source', 'site-settings.json')
const indexPath = path.join(root, 'public', 'index.html')
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
const html = fs.readFileSync(indexPath, 'utf8')
const marker = `<title>Locale:${settings.defaultLocale}</title>`
if (!html.includes(marker)) {
  console.error(`public/index.html 缺少与 defaultLocale 一致的标记: ${marker}`)
  process.exit(3)
}
process.exit(0)
