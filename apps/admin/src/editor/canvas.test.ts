import { expect,it } from 'vitest'
import { createMemorySourceReader } from '@olps/render'
import { createCanvasDocument } from './canvas'

it('画布使用受限脚本策略和签名资源，主题脚本不进入画布',async()=>{
  const reader=createMemorySourceReader({'themes/starter/assets/style.css':'.hero{background-image:url("/assets/uploads/background.svg")}'})
  const html='<html><head><link rel="stylesheet" href="/assets/theme/starter/style.css"></head><body><div data-olps-block="heading" data-olps-block-type="core/heading"><h2>Heading</h2><img src="/assets/uploads/image.svg"></div><script>parent.leaked=true</script></body></html>'
  const result=await createCanvasDocument(html,reader,{token:crypto.randomUUID(),resourceBaseUrl:'/api/drafts/site/resources/',expiresAt:new Date(Date.now()+900000).toISOString()},[],'heading')
  const document=new DOMParser().parseFromString(result,'text/html')
  expect(result).not.toContain('parent.leaked')
  expect(document.querySelectorAll('script')).toHaveLength(1)
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(document.querySelector('script')!.textContent!))
  const hash=btoa(String.fromCharCode(...new Uint8Array(digest)))
  expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')).toContain(`script-src 'sha256-${hash}'`)
  expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')).toContain("connect-src 'none'")
  expect(document.querySelector('img')!.src).toContain('/api/drafts/site/resources/assets/uploads/image.svg?token=')
  expect(document.querySelector('style')!.textContent).toContain('/api/drafts/site/resources/assets/uploads/background.svg?token=')
  expect(document.querySelector('[data-editor-selected]')!.getAttribute('data-olps-block')).toBe('heading')
})
