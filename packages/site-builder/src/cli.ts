import { buildSite } from './build.js'
import { verifySite } from './verify.js'

const workspacePath = process.cwd()
const verifyMode = process.argv.includes('--verify')

async function main(): Promise<void> {
  if (verifyMode) {
    await verifySite(workspacePath)
    return
  }
  await buildSite(workspacePath)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
