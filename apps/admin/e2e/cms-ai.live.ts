import { expect,test } from '@playwright/test'
import { cmsWebsite,selectCmsWebsite } from './cms-fixtures'

const apiBase=process.env.OLPS_API_URL??'http://127.0.0.1:8787'
test('真实模型生成、修改、翻译和发布内容全部成功',async({page,request})=>{
  expect(process.env.AI_API_KEY?.trim(),'真实模型验收缺少AI_API_KEY，请配置实际模型服务后运行test:e2e:live').toBeTruthy()
  const site=await cmsWebsite(request,apiBase)
  await selectCmsWebsite(page,site);await page.goto('/generate')
  const execute=async(type:string)=>{
    const submitted=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/jobs/${type}`)
    await page.getByRole('button',{name:'开始处理',exact:true}).click()
    const response=await submitted;expect(response.status(),await response.text()).toBe(202)
    const id=(await response.json() as {job:{jobId:string}}).job.jobId
    let result:{status:string;error:unknown;result:{nodeIds?:string[]}}|undefined
    await expect.poll(async()=>{
      const current=await request.get(`${apiBase}/api/jobs/${id}`,{headers:site.identity.headers});expect(current.ok(),await current.text()).toBe(true)
      result=(await current.json() as {job:typeof result}).job
      if(result?.status==='failed')throw new Error(`真实模型处理失败：${JSON.stringify(result.error)}`)
      return result?.status
    },{timeout:600000}).toBe('completed')
    await expect(page.getByRole('status').filter({hasText:'处理完成'})).toBeVisible()
    return result!.result
  }
  const marker=`Model generated heading ${Date.now()}`
  await page.getByRole('combobox',{name:'处理内容',exact:true}).selectOption('generate_node')
  await page.getByLabel('新内容名称',{exact:true}).fill('Manufacturing capabilities')
  await page.getByLabel('你的要求',{exact:true}).fill(`生成英文企业能力介绍页面。使用core/heading区块显示准确文字 ${marker}，介绍工业泵生产流程。保留系统设置，生成可发布内容。`)
  const generated=await execute('generate_node'),pageId=generated.nodeIds?.[0];expect(pageId).toBeTruthy()
  const get=async(locale='en')=>{const response=await request.get(`${apiBase}/api/drafts/${site.draftId}/content/page/${pageId}?locale=${locale}`,{headers:site.identity.headers});expect(response.ok(),await response.text()).toBe(true);return await response.json() as {content:{meta:Record<string,unknown>;locale:{title:string;slug:string;blocks:unknown[];sourceHash:string|null}};revision:string}}
  const original=await get();expect(JSON.stringify(original.content.locale.blocks)).toContain(marker)
  await page.getByRole('combobox',{name:'处理内容',exact:true}).selectOption('revise_node')
  await page.getByRole('combobox',{name:'选择已有内容',exact:true}).selectOption(`page:${pageId}`)
  const revised=`Revised manufacturing heading ${Date.now()}`
  await page.getByLabel('你的要求',{exact:true}).fill(`把页面中标题区块的文字准确修改为 ${revised}。保留其他区块和页面标识。`)
  await execute('revise_node');expect(JSON.stringify((await get()).content.locale.blocks)).toContain(revised)
  await page.getByRole('combobox',{name:'处理内容',exact:true}).selectOption('translate_node')
  await page.getByRole('combobox',{name:'选择已有内容',exact:true}).selectOption(`page:${pageId}`)
  await page.getByLabel('翻译为',{exact:true}).selectOption('zh-CN')
  await page.getByLabel('你的要求',{exact:true}).fill('准确翻译为简体中文，保留英文原文和内容标识。')
  await execute('translate_node');expect((await get('zh-CN')).content.locale.sourceHash).toBeTruthy()
  const current=await get();current.content.meta.status='published'
  const saved=await request.put(`${apiBase}/api/drafts/${site.draftId}/content/page/${pageId}`,{headers:{...site.identity.headers,'If-Match':`"${current.revision}"`},data:current.content});expect(saved.ok(),await saved.text()).toBe(true)
  await page.goto('/publish')
  const publication=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/sites/${site.siteId}/publish`)
  await page.getByRole('button',{name:'发布网站',exact:true}).click();const published=await publication;expect(published.ok(),await published.text()).toBe(true)
  const publicUrl=(await published.json() as {record:{publicUrl:string}}).record.publicUrl
  const html=await request.get(`${publicUrl.replace(/\/$/,'')}/en/${current.content.locale.slug}/`);expect(html.ok(),await html.text()).toBe(true);expect(await html.text()).toContain(revised)
})
