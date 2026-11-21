import {createServer} from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {expect,it} from 'vitest'
import {chromium} from 'playwright'
import {createMemorySourceReader,loadSiteModel,renderTarget} from '@olps/render'
import {buildBuiltinSiteFiles} from './site-files.js'
import {pluginRoot} from './paths.js'

it('地图公开配置生成访客点击后才建立的官方iframe，空key保留地址与链接',async()=>{
  const files=await buildBuiltinSiteFiles(),reader=createMemorySourceReader(files),model=await loadSiteModel(reader)
  model.plugins.plugins['google-maps']!.settings={defaultAddress:{en:'25 Harbour Street'},browserApiKey:'local-browser-embed-key',apiKey:'PRIVATE_SERVER_KEY'}
  const configured=await renderTarget(model,{kind:'page',pageId:'11111111-1111-4111-8111-111111111103'},'en',{mode:'publish',reader})
  expect(configured).not.toContain('PRIVATE_SERVER_KEY')
  model.plugins.plugins['google-maps']!.settings={defaultAddress:'25 Harbour Street'}
  const unconfigured=await renderTarget(model,{kind:'page',pageId:'11111111-1111-4111-8111-111111111103'},'en',{mode:'publish',reader})
  const script=await fs.readFile(path.join(pluginRoot('google-maps'),'assets/map.js'))
  const server=createServer((request,response)=>{
    if(request.url==='/assets/plugin/google-maps/map.js'){response.writeHead(200,{'Content-Type':'text/javascript'});response.end(script);return}
    if(request.url==='/'||request.url==='/without-key'){response.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"frame-src 'none'"});response.end(request.url==='/'?configured:unconfigured);return}
    response.writeHead(404);response.end()
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage(),googleRequests:string[]=[]
    page.setDefaultTimeout(5000)
    page.on('request',request=>{if(new URL(request.url()).hostname.endsWith('google.com'))googleRequests.push(request.url())})
    const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`
    await page.goto(base)
    expect(await page.locator('[data-olps-map-canvas] iframe').count()).toBe(0)
    expect(googleRequests).toEqual([])
    await page.locator('[data-olps-map-load]').click()
    const frame=page.locator('[data-olps-map-canvas] iframe')
    expect(await frame.count()).toBe(1)
    const url=new URL((await frame.getAttribute('src'))!)
    expect(url.origin).toBe('https://www.google.com')
    expect(url.pathname).toBe('/maps/embed/v1/place')
    expect(url.searchParams.get('q')).toBe('25 Harbour Street')
    expect(url.searchParams.get('key')).toBe('local-browser-embed-key')
    expect(await frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
    expect(await frame.evaluate(element=>element.clientWidth)).toBeGreaterThanOrEqual(200)
    expect(await frame.evaluate(element=>element.clientHeight)).toBeGreaterThanOrEqual(200)
    expect(await page.locator('[data-olps-map-ready]').count()).toBe(0)
    await page.goto(`${base}/without-key`)
    expect(await page.locator('[data-olps-map-load]').count()).toBe(0)
    expect(await page.locator('[data-olps-map-address]').textContent()).toBe('25 Harbour Street')
    expect(await page.locator('.olps-google-maps a').getAttribute('href')).toContain('https://www.google.com/maps/search/')
  }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
