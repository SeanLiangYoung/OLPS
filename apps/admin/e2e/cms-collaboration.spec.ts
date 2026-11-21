import { expect,test } from '@playwright/test'
import { cmsIdentity,cmsWebsite,selectCmsWebsite,editCmsHeading } from './cms-fixtures'
import { startDedicatedE2eStack } from './dedicated-e2e-stack'

test.use({actionTimeout:30000})
test('发布界面展示真实Agent协作问题，运营回答后继续同一次发布',async({browser,request})=>{
  test.setTimeout(1200000)
  const stack=await startDedicatedE2eStack('cms-collaboration')
  const apiBase=stack.apiBaseUrl
  const contextA=await browser.newContext(),contextB=await browser.newContext()
  try{
    const a=await cmsWebsite(request,apiBase),bIdentity=await cmsIdentity(request,apiBase)
    const added=await request.post(`${apiBase}/api/sites/${a.siteId}/owners`,{headers:a.identity.headers,data:{account:bIdentity.account}});expect(added.ok(),await added.text()).toBe(true)
    await editCmsHeading(request,apiBase,a,'Original collaboration heading')
    const pageA=await contextA.newPage(),pageB=await contextB.newPage()
    await selectCmsWebsite(pageA,a);await pageA.goto(`${stack.adminBaseUrl}/publish`)
    const publishA=async()=>{const response=pageA.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/sites/${a.siteId}/publish`,{timeout:600000});await pageA.getByRole('button',{name:'发布网站',exact:true}).click();const result=await response;expect(result.ok(),await result.text()).toBe(true);return(await result.json() as {record:{publicUrl:string}}).record}
    await publishA();console.log('默认网站已发布')
    const draft=await request.post(`${apiBase}/api/drafts`,{headers:bIdentity.headers,data:{siteId:a.siteId,name:'协作运营编辑版本'}});expect(draft.status(),await draft.text()).toBe(201)
    const b={siteId:a.siteId,draftId:(await draft.json() as {draft:{draftId:string}}).draft.draftId,identity:bIdentity}
    await editCmsHeading(request,apiBase,a,'Selected collaborative red heading')
    await editCmsHeading(request,apiBase,b,'Alternative collaborative green heading')
    await publishA();console.log('协作成员修改已发布')
    await selectCmsWebsite(pageB,b);await pageB.goto(`${stack.adminBaseUrl}/publish`)
    const conflict=pageB.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/sites/${a.siteId}/publish`,{timeout:600000})
    await pageB.getByRole('button',{name:'发布网站',exact:true}).click();expect((await conflict).status()).toBe(409);console.log('协作发布已返回待确认状态')
    const confirmation=pageB.getByRole('region',{name:'协作内容确认'})
    await expect(confirmation).toBeVisible();await expect(confirmation).toContainText(/heading|标题/)
    await expect(confirmation).not.toContainText('source/pages/')
    await pageB.getByLabel('你的处理要求').fill('明确选择 Selected collaborative red heading，保留双方全部其他内容，并继续完成本次发布。');console.log('运营已填写协作处理要求')
    const continued=pageB.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/continue'),{timeout:600000})
    await pageB.getByRole('button',{name:'确认并继续',exact:true}).click();const response=await continued;expect(response.ok(),await response.text()).toBe(true)
    await expect(confirmation).toHaveCount(0);await expect(pageB.getByRole('status')).toContainText('已根据回答继续处理')
    const publicUrl=await pageB.getByRole('link',{name:'查看网站',exact:true}).first().getAttribute('href');expect(publicUrl).toBeTruthy()
    const online=await request.get(`${publicUrl!.replace(/\/$/,'')}/en/`);expect(online.ok(),await online.text()).toBe(true)
    const html=await online.text();expect(html).toContain('Selected collaborative red heading');expect(html).not.toContain('Alternative collaborative green heading')
  }finally{await contextA.close();await contextB.close();await stack.stop()}
})
