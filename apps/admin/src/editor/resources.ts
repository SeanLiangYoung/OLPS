import { loadSiteModel,type SiteModel } from '@olps/render'
import { api } from '../api'
import { createApiSourceReader } from './source-reader'
import type { ResourceAccess } from './canvas'

type Resources={model:SiteModel;access:ResourceAccess}
type Entry={promise:Promise<Resources>;refreshAt:number}
const cache=new Map<string,Entry>()
export function clearEditorResources(draftId:string):void{cache.delete(draftId)}
export function editorResourceRefreshDelay(access:Pick<ResourceAccess,'expiresAt'>):number{
  const remaining=Date.parse(access.expiresAt)-Date.now()
  if(!Number.isFinite(remaining))throw new Error('资源授权期限无效')
  return Math.max(20,remaining-Math.min(60000,remaining/5))
}
function createEntry(draftId:string):Promise<Resources>{
  const entry:Entry={refreshAt:Infinity,promise:Promise.all([loadSiteModel(createApiSourceReader(draftId)),api<ResourceAccess>('POST',`/api/drafts/${encodeURIComponent(draftId)}/resource-access`)]).then(([model,access])=>{
    entry.refreshAt=Date.now()+editorResourceRefreshDelay(access)
    return {model,access}
  }).catch(error=>{if(cache.get(draftId)===entry)cache.delete(draftId);throw error})}
  cache.set(draftId,entry)
  return entry.promise
}
export async function loadEditorResources(draftId:string,invalidToken?:string):Promise<Resources>{
  const current=cache.get(draftId)
  if(!current)return createEntry(draftId)
  const resources=await current.promise
  if(cache.get(draftId)!==current)return loadEditorResources(draftId,invalidToken)
  if(current.refreshAt<=Date.now()||(invalidToken!==undefined&&resources.access.token===invalidToken))return createEntry(draftId)
  return resources
}
