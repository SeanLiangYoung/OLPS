import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const settings = JSON.parse(
  fs.readFileSync(path.join(root, 'source', 'site-settings.json'), 'utf8'),
)
const indexPath = path.join(root, 'public', 'index.html')
let bodyInner = ''
try {
  const existing = fs.readFileSync(indexPath, 'utf8')
  const match = existing.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (match) {
    bodyInner = match[1]
  }
} catch {
  bodyInner = ''
}
const outDir = path.join(root, 'public')
fs.mkdirSync(outDir, { recursive: true })
const brand = settings.brandColor ?? ''
const email = settings.supportEmail ?? ''
const html = `<!DOCTYPE html><html><head><title>Locale:${settings.defaultLocale}</title></head><body data-brand="${brand}" data-email="${email}">${bodyInner}</body></html>`
fs.writeFileSync(indexPath, html, 'utf8')
process.exit(0)
