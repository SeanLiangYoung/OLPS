import { spawnSync } from 'node:child_process'
import { expect,it } from 'vitest'

it('主流程验收缺少真实模型和外部配置时明确失败',()=>{
  const environment={...process.env,AI_API_KEY:'',GOOGLE_OAUTH_CLIENT_ID:'',GOOGLE_OAUTH_CLIENT_SECRET:'',GOOGLE_ADS_DEVELOPER_TOKEN:'',META_APP_ID:'',META_APP_SECRET:'',MVP_CHECK_SITE_ID:'',MVP_CHECK_DRAFT_ID:'',MVP_SFTP_CONFIG:'',MVP_S3_CONFIG:'',MVP_NGINX_BASE_URL:'',MVP_IIS_BASE_URL:'',MVP_SERVE_BASE_URL:'',MVP_STATIC_DEPLOY_COMMAND_JSON:'',MVP_GCLID:''}
  const result=spawnSync(process.execPath,['--import','tsx','src/mvp-check.ts'],{cwd:process.cwd(),env:environment,encoding:'utf8',timeout:30000})
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('主流程验收缺少配置')
  for(const name of ['AI_API_KEY','GOOGLE_OAUTH_CLIENT_ID','META_APP_ID','MVP_SFTP_CONFIG','MVP_S3_CONFIG','MVP_IIS_BASE_URL'])expect(result.stderr).toContain(name)
  expect(result.stdout).not.toContain('验收通过')
})
