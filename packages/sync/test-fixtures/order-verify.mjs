import fs from 'node:fs'
import path from 'node:path'

const marker = path.join(process.cwd(), '.olps-order', 'log.txt')
let prior = ''
try {
  prior = fs.readFileSync(marker, 'utf8')
} catch {
  prior = ''
}
if (!prior.startsWith('build')) {
  console.error('verify 在 build 之前执行')
  process.exit(2)
}
fs.writeFileSync(marker, `${prior}verify\n`, 'utf8')
process.exit(0)
