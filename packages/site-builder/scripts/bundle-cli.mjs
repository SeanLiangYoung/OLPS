import { execSync } from 'node:child_process'
import esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
})
