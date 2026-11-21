import { pool } from './db.js'
import { upgradeCms } from './cms-upgrade.js'
import { cmsUpgradeVersion } from './cms-readiness.js'

try{
  await upgradeCms(pool)
  console.log(JSON.stringify({status:'completed',version:cmsUpgradeVersion}))
}catch(error){
  console.error(error)
  process.exitCode=1
}finally{await pool.end()}
