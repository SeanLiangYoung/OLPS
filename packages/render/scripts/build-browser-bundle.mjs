import * as esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.join(__dirname, '..')

await esbuild.build({
  entryPoints: [path.join(packageRoot, 'src', 'browser-entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(packageRoot, 'test-fixtures', 'browser-render.bundle.mjs'),
  sourcemap: false,
  logLevel: 'info',
})
