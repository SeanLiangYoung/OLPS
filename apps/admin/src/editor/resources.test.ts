import { expect,it } from 'vitest'
import { editorResourceRefreshDelay } from './resources'

it('资源签名按真实剩余期限提前续签，短期限同样保留更新时间',()=>{
  const long=editorResourceRefreshDelay({expiresAt:new Date(Date.now()+900000).toISOString()})
  expect(long).toBeGreaterThan(800000);expect(long).toBeLessThan(900000)
  const short=editorResourceRefreshDelay({expiresAt:new Date(Date.now()+3000).toISOString()})
  expect(short).toBeGreaterThan(1000);expect(short).toBeLessThan(3000)
  expect(editorResourceRefreshDelay({expiresAt:new Date(Date.now()-1000).toISOString()})).toBe(20)
  expect(()=>editorResourceRefreshDelay({expiresAt:'invalid'})).toThrow('资源授权期限无效')
})
