import {createServer} from 'node:http'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {beforeAll,expect,it} from 'vitest'
import {chromium,type Page} from 'playwright'

let script:Buffer
beforeAll(async()=>{execFileSync(process.execPath,['scripts/build.mjs']);script=await fs.readFile('dist/olps-tracking.js')})
async function trackingPage(check:(page:Page,events:Array<{name:string}>)=>Promise<void>){
  const events:Array<{name:string}>=[]
  const server=createServer(async(request,response)=>{
    if(request.url==='/runtime.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return}
    if(request.url==='/events'&&request.method==='POST'){
      const parts=[];for await(const part of request)parts.push(Buffer.from(part))
      events.push(JSON.parse(Buffer.concat(parts).toString()))
      response.writeHead(202,{'Content-Type':'application/json'});response.end('{"accepted":true}');return
    }
    response.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"script-src 'self'; connect-src 'self'"})
    response.end(`<!doctype html><html lang="en"><head><title>Consent checks</title></head><body><button data-olps-cookie-settings>Cookie settings</button><script id="olps-tracking-config" type="application/json">${JSON.stringify({connectors:{ga4:{measurementId:'G-CONSENTCHECK'},gtm:{containerId:'GTM-CONSENTCHECK'},meta:{pixelId:'1234567890'}},locale:'en',cookiePolicyUrl:'/cookies',eventCollector:{endpoint:'/events',target:{ref:'page',id:randomUUID()}}})}</script><script src="/runtime.js"></script></body></html>`)
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage()
    page.setDefaultTimeout(5000)
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/`)
    await check(page,events)
  }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
it('只允许广告后在同页开启统计，真实HTTP与GA4浏览器队列各有一次页面事件',async()=>{
  await trackingPage(async(page,events)=>{
    await page.getByRole('button',{name:'Customize',exact:true}).click()
    await page.locator('[data-olps-consent-advertising]').check()
    await page.getByRole('button',{name:'Save settings',exact:true}).click()
    expect(events).toEqual([])
    const gaViews=()=>page.evaluate(()=>window.dataLayer.filter((entry:unknown)=>Array.isArray(entry)&&entry[0]==='event'&&entry[1]==='page_view').length)
    const metaViews=()=>page.evaluate(()=>window.fbq.calls.filter(entry=>entry[0]==='track'&&entry[1]==='PageView').length)
    expect(await gaViews()).toBe(0)
    expect(await metaViews()).toBe(1)
    await page.locator('[data-olps-cookie-settings]').click()
    await page.locator('[data-olps-consent-analytics]').check()
    await page.getByRole('button',{name:'Save settings',exact:true}).click()
    await expect.poll(()=>events.filter(event=>event.name==='page_view').length).toBe(1)
    expect(await gaViews()).toBe(1)
    expect(await metaViews()).toBe(1)
    await page.locator('[data-olps-cookie-settings]').click()
    await page.getByRole('button',{name:'Save settings',exact:true}).click()
    expect(await gaViews()).toBe(1)
    expect(events.filter(event=>event.name==='page_view')).toHaveLength(1)
    await page.evaluate(()=>window.olps.emit('inquiry_submit'))
    expect(await page.evaluate(()=>window.dataLayer.some((entry:unknown)=>entry&&typeof entry==='object'&&!Array.isArray(entry)&&'event'in entry&&entry.event==='generate_lead'))).toBe(true)
  })
})
it('全部接受后通过页脚打开设置直接保存，以及重新访问，均保留原同意状态',async()=>{
  await trackingPage(async page=>{
    await page.getByRole('button',{name:'Accept all',exact:true}).click()
    for(const reload of [false,true]){
      if(reload)await page.reload()
      await page.locator('[data-olps-cookie-settings]').click()
      expect(await page.locator('[data-olps-consent-analytics]').isChecked()).toBe(true)
      expect(await page.locator('[data-olps-consent-advertising]').isChecked()).toBe(true)
      await page.getByRole('button',{name:'Save settings',exact:true}).click()
      expect(await page.evaluate(()=>window.olps.getConsent())).toEqual({analytics:true,advertising:true})
    }
  })
})
