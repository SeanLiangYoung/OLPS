import * as esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

await esbuild.build({
  entryPoints: [path.join(packageRoot, 'src', 'index.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: path.join(packageRoot, 'dist', 'olps-tracking.js'),
  sourcemap: false,
  logLevel: 'info',
})
