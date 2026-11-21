import {randomUUID} from 'node:crypto'
import {expect,test} from '@playwright/test'
import {startDedicatedE2eStack} from './dedicated-e2e-stack'
import {cmsWebsite} from './cms-fixtures'

test('插件配置经过实际保存、预览和公开发布后显示电话号码、语言文字与地图地址',async({page,request})=>{
  test.setTimeout(300000)
  page.setDefaultTimeout(20000)
  const stack=await startDedicatedE2eStack('cms-plugin-consumption')
  try{
    const website=await cmsWebsite(request,stack.apiBaseUrl),headers=website.identity.headers
    await page.addInitScript(({token,siteId,draftId})=>{if(window!==window.top)return;localStorage.setItem('olps_access_token',token);localStorage.setItem('olps_site_id',siteId);localStorage.setItem('olps_draft_id',draftId);localStorage.setItem('olps_content_locale','en')},{token:website.identity.token,siteId:website.siteId,draftId:website.draftId})
    await page.goto(`${stack.adminBaseUrl}/plugins`)
    const whatsapp=page.locator('article').filter({has:page.getByRole('heading',{name:'WhatsApp',exact:true})})
    await whatsapp.getByRole('button',{name:'设置',exact:true}).click()
    await page.getByLabel('WhatsApp 电话号码',{exact:true}).fill('+86 13800138000')
    await page.getByLabel('按钮文字',{exact:true}).fill('Contact our team')
    await page.getByLabel('显示位置',{exact:true}).selectOption('bottom-left')
    await page.getByRole('button',{name:'保存设置',exact:true}).click()
    await expect(page.getByRole('status')).toHaveText('插件设置已保存')
    const base=`${stack.apiBaseUrl}/api/drafts/${website.draftId}`
    const savedWa=await(await request.get(`${base}/plugins/whatsapp/settings`,{headers})).json()
    const translated=await request.put(`${base}/plugins/whatsapp/settings`,{headers:{...headers,'If-Match':`"${savedWa.revision}"`},data:{settings:{...savedWa.settings,buttonLabel:{en:'Contact our team','zh-CN':'联系团队'}}}})
    expect(translated.ok(),await translated.text()).toBe(true)
    const maps=await(await request.get(`${base}/plugins/google-maps/settings`,{headers})).json()
    const mapped=await request.put(`${base}/plugins/google-maps/settings`,{headers:{...headers,'If-Match':`"${maps.revision}"`},data:{settings:{defaultAddress:{en:'25 Harbour Street','zh-CN':'港口街25号'},browserApiKey:'local-browser-embed-key'}}})
    expect(mapped.ok(),await mapped.text()).toBe(true)
    const homePath=`${base}/content/page/11111111-1111-4111-8111-111111111101?locale=en`
    const home=await(await request.get(homePath,{headers})).json()
    home.content.locale.blocks.push({id:'plugin-address',type:'plugin/google-maps/map',props:{},children:[]})
    const contentSaved=await request.put(homePath,{headers:{...headers,'If-Match':`"${home.revision}"`},data:home.content})
    expect(contentSaved.ok(),await contentSaved.text()).toBe(true)
    const preview=await request.post(`${base}/preview`,{headers,data:{locale:'en',returnPath:'/plugins'}})
    expect(preview.ok(),await preview.text()).toBe(true)
    await page.goto(`${stack.adminBaseUrl}${(await preview.json()).previewUrl}`)
    const floating=page.locator('[data-olps-whatsapp-float]')
    await expect(floating).toHaveText('Contact our team')
    await expect(floating).toHaveAttribute('href','https://wa.me/8613800138000')
    await expect(floating).toHaveAttribute('data-position','bottom-left')
    await expect(floating).toHaveCSS('position','fixed')
    await expect(page.locator('[data-olps-map-address]')).toHaveText('25 Harbour Street')
    await expect(page.locator('[data-olps-map-canvas]')).toHaveAttribute('data-olps-map-key','local-browser-embed-key')
    await expect(page.locator('[data-olps-map-canvas] iframe')).toHaveCount(0)
    const published=await request.post(`${stack.apiBaseUrl}/api/sites/${website.siteId}/publish`,{headers,data:{draftId:website.draftId,requestKey:randomUUID()}})
    expect(published.ok(),await published.text()).toBe(true)
    const result=await published.json()
    expect(result.record.status).toBe('completed')
    const publicUrl=result.record.publicUrl.replace(/\/$/,'')
    await page.goto(`${publicUrl}/en/`)
    await expect(page.locator('[data-olps-whatsapp-float]')).toHaveAttribute('href','https://wa.me/8613800138000')
    await expect(page.locator('[data-olps-map-address]')).toHaveText('25 Harbour Street')
    await expect(page.locator('[data-olps-map-load]')).toBeVisible()
    await expect(page.locator('[data-olps-map-canvas] iframe')).toHaveCount(0)
    await page.goto(`${publicUrl}/zh-CN/`)
    await expect(page.locator('[data-olps-whatsapp-float]')).toHaveText('联系团队')
  }finally{await stack.stop()}
})
