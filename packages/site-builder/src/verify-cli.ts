import { verifySite } from './verify.js'

verifySite(process.cwd()).catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
