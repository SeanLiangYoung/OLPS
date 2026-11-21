import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { expect,it } from 'vitest'
import { chromium } from 'playwright'

it('真实HTTP统计在同意后发送页面、下载、外链及滚动事件，拒绝时保持静默',async()=>{
  execFileSync(process.execPath,['scripts/build.mjs'])
  const script=await fs.readFile(path.resolve('dist/olps-tracking.js'))
  const events:Array<{name:string;eventId:string;locale:string;target:{ref:string;id:string};payload:Record<string,unknown>}>=[]
  const target={ref:'page',id:randomUUID()}
  const outside=createServer((_request,response)=>{response.end('<!doctype html><title>外部页面</title>')})
  await new Promise<void>(resolve=>outside.listen(0,'127.0.0.1',resolve))
  const outsidePort=(outside.address() as {port:number}).port
  const server=createServer(async(request,response)=>{
    if(request.url==='/olps-tracking.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return}
    if(request.url==='/events'&&request.method==='POST'){
      const bytes=[];for await(const chunk of request)bytes.push(Buffer.from(chunk))
      events.push(JSON.parse(Buffer.concat(bytes).toString()))
      response.writeHead(202,{'Content-Type':'application/json'});response.end('{"accepted":true}');return
    }
    if(request.url==='/manual.txt'){response.setHeader('Content-Type','text/plain');response.end('说明文件');return}
    response.setHeader('Content-Type','text/html')
    response.end(`<!doctype html><html lang="en"><head><title>Native events</title></head><body><a id="download" href="/manual.txt" download>下载说明</a><a id="outbound" href="http://127.0.0.1:${outsidePort}/" target="_blank">外部页面</a><div style="height:5000px">浏览内容</div><script id="olps-tracking-config" type="application/json">${JSON.stringify({connectors:{},locale:'en',cookiePolicyUrl:'/cookies',eventCollector:{endpoint:'/events',target}})}</script><script src="/olps-tracking.js"></script></body></html>`)
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage({acceptDownloads:true})
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/`)
    await page.getByRole('button',{name:'Reject all',exact:true}).click()
    await page.locator('#download').click()
    await page.waitForTimeout(100)
    expect(events).toEqual([])
    await page.reload()
    await page.evaluate(()=>{document.cookie='olps_consent=; Max-Age=0; path=/'})
    await page.reload()
    await page.getByRole('button',{name:'Accept all',exact:true}).click()
    await expect.poll(()=>events.filter(event=>event.name==='page_view').length).toBe(1)
    await page.locator('#download').click()
    const popup=page.waitForEvent('popup')
    await page.locator('#outbound').click();await(await popup).close()
    await page.mouse.wheel(0,10000)
    await expect.poll(()=>events.map(event=>event.name)).toContain('download_click')
    await expect.poll(()=>events.map(event=>event.name)).toContain('outbound_click')
    await expect.poll(()=>events.filter(event=>event.name==='scroll_depth').length).toBe(4)
    expect(events.every(event=>event.target.id===target.id&&event.locale==='en')).toBe(true)
    expect(new Set(events.map(event=>event.eventId)).size).toBe(events.length)
    await page.close()
  }finally{
    await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise<void>(resolve=>outside.close(()=>resolve()))
  }
},30000)
