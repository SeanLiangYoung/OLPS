import fs from 'node:fs'
import path from 'node:path'

const marker = path.join(process.cwd(), '.olps-order', 'log.txt')
fs.mkdirSync(path.dirname(marker), { recursive: true })
fs.writeFileSync(marker, 'build\n', 'utf8')
process.exit(0)
