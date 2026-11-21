import { expect,test } from '@playwright/test'
import { startDedicatedE2eStack } from './dedicated-e2e-stack'
import { cmsWebsite,selectCmsWebsite,editCmsHeading } from './cms-fixtures'

test.describe.configure({mode:'serial'})
test.use({actionTimeout:30000})
for(const operation of ['publish','pull'] as const)test(`发布界面在远端停止后显示错误，重新启动后完成${operation==='publish'?'发布':'取得协作更新'}`,async({page,request})=>{
  test.setTimeout(300000)
  const stack=await startDedicatedE2eStack(`cms-${operation}-retry`)
  try{
    const website=await cmsWebsite(request,stack.apiBaseUrl)
    await selectCmsWebsite(page,website);await page.goto(`${stack.adminBaseUrl}/publish`)
    const initial=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/sites/${website.siteId}/publish`)
    await page.getByRole('button',{name:'发布网站',exact:true}).click();const published=await initial;expect(published.ok(),await published.text()).toBe(true)
    if(operation==='publish')await editCmsHeading(request,stack.apiBaseUrl,website,'Recovered publication heading')
    await stack.stopRemoteOnly()
    const pathname=operation==='publish'?`/api/sites/${website.siteId}/publish`:`/api/sites/${website.siteId}/drafts/${website.draftId}/pull`
    const button=operation==='publish'?'发布网站':'取得协作更新'
    const failed=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===pathname)
    await page.getByRole('button',{name:button,exact:true}).click();expect((await failed).ok()).toBe(false)
    await expect(page.getByRole('alert')).not.toBeEmpty()
    await stack.restartRemote()
    const retry=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===pathname)
    await page.getByRole('button',{name:button,exact:true}).click();const recovered=await retry;expect(recovered.ok(),await recovered.text()).toBe(true)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText(operation==='publish'?'网站发布流程已完成':'已取得协作成员发布的最新内容')
    if(operation==='publish'){
      const publicUrl=await page.getByRole('link',{name:'查看网站',exact:true}).first().getAttribute('href')
      const online=await request.get(`${publicUrl!.replace(/\/$/,'')}/en/`);expect(online.ok(),await online.text()).toBe(true)
      expect(await online.text()).toContain('Recovered publication heading')
    }
  }finally{await stack.stop()}
})
