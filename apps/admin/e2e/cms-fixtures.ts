import { randomUUID } from 'node:crypto'
import { expect,type APIRequestContext,type Page } from '@playwright/test'

export type CmsIdentity={token:string;account:string;headers:Record<string,string>}
export type CmsWebsite={siteId:string;draftId:string;identity:CmsIdentity}
export async function cmsIdentity(request:APIRequestContext,base:string):Promise<CmsIdentity>{
  const account=`cms-${randomUUID()}`
  const response=await request.post(`${base}/api/auth/register`,{data:{account,password:'CmsAcceptance123!',name:'验收运营'}})
  expect(response.status(),await response.text()).toBe(201)
  const result=await response.json() as {accessToken:string}
  return{token:result.accessToken,account,headers:{Authorization:`Bearer ${result.accessToken}`}}
}
export async function cmsWebsite(request:APIRequestContext,base:string,identity?:CmsIdentity):Promise<CmsWebsite>{
  const owner=identity??await cmsIdentity(request,base)
  const response=await request.post(`${base}/api/sites`,{headers:owner.headers,data:{name:'浏览器协作验收'}})
  expect(response.status(),await response.text()).toBe(201)
  const created=await response.json() as {site:{siteId:string};draft:{draftId:string}}
  await expect.poll(async()=>{const state=await(await request.get(`${base}/api/sites/${created.site.siteId}/initialization`,{headers:owner.headers})).json() as {initStatus:string;error:string};if(state.initStatus==='failed')throw new Error(state.error);return state.initStatus},{timeout:120000}).toBe('ready')
  return{siteId:created.site.siteId,draftId:created.draft.draftId,identity:owner}
}
export async function selectCmsWebsite(page:Page,website:CmsWebsite){
  await page.addInitScript(({token,siteId,draftId})=>{localStorage.setItem('olps_access_token',token);localStorage.setItem('olps_site_id',siteId);localStorage.setItem('olps_draft_id',draftId);localStorage.setItem('olps_content_locale','en')},{token:website.identity.token,siteId:website.siteId,draftId:website.draftId})
}
export async function editCmsHeading(request:APIRequestContext,base:string,website:CmsWebsite,text:string){
  const path=`${base}/api/drafts/${website.draftId}/content/page/11111111-1111-4111-8111-111111111101?locale=en`
  const response=await request.get(path,{headers:website.identity.headers});expect(response.ok(),await response.text()).toBe(true)
  const current=await response.json() as {content:{ref:string;meta:Record<string,unknown>;locale:{blocks:Array<{id:string;type:string;props:Record<string,unknown>;children:unknown[]}>}};revision:string}
  const existing=current.content.locale.blocks.find(block=>block.id==='acceptance-primary-heading')
  if(existing)existing.props.text=text
  else current.content.locale.blocks.push({id:'acceptance-primary-heading',type:'core/heading',props:{text,level:2},children:[]})
  const saved=await request.put(path,{headers:{...website.identity.headers,'If-Match':`"${current.revision}"`},data:current.content});expect(saved.ok(),await saved.text()).toBe(true)
}
