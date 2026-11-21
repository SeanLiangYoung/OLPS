import { execSync } from 'node:child_process'
import esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(packageRoot, '../..')

execSync('npm run build -w @olps/domain', { cwd: repoRoot, stdio: 'inherit' })

await esbuild.build({
  entryPoints: [path.join(packageRoot, 'src', 'cli.ts')],
  outfile: path.join(packageRoot, 'dist', 'site-build.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
  packages: 'external',
})

await esbuild.build({
  entryPoints: [path.join(packageRoot, 'src', 'verify-cli.ts')],
  outfile: path.join(packageRoot, 'dist', 'site-verify.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  alias: { 'css-tree': createRequire(import.meta.url).resolve('css-tree') },
})
