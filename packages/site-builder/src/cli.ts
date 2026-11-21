import { buildSite } from './build.js'
import { verifySite } from './verify.js'
import { z } from 'zod'

const workspacePath = process.cwd()
const verifyMode = process.argv.includes('--verify')

async function main(): Promise<void> {
  if (verifyMode) {
    await verifySite(workspacePath)
    return
  }
  const pluginSecrets=z.record(z.string(),z.record(z.string(),z.string())).parse(JSON.parse(process.env.OLPS_BUILD_PLUGIN_SECRETS??'{}'))
  await buildSite(workspacePath,{pluginSecrets})
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
