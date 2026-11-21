import type { SourceReader } from '@olps/render'
import { api,ApiError } from '../api'

export function createApiSourceReader(draftId:string):SourceReader{
  const base=`/api/drafts/${encodeURIComponent(draftId)}/source`
  const textCache=new Map<string,Promise<string>>()
  const listCache=new Map<string,Promise<string[]>>()
  async function load<T>(path:string):Promise<T>{
    try{return await api<T>('GET',path)}
    catch(error){
      if(error instanceof ApiError&&error.status===404){const missing=new Error('资料不存在') as Error&{code:string};missing.code='ENOENT';throw missing}
      throw error
    }
  }
  return {
    async readText(file:string):Promise<string>{if(!textCache.has(file))textCache.set(file,load<{text:string}>(`${base}?path=${encodeURIComponent(file)}`).then(result=>result.text));return textCache.get(file)!},
    async list(directory:string):Promise<string[]>{if(!listCache.has(directory))listCache.set(directory,load<{entries:string[]}>(`${base}?path=${encodeURIComponent(directory)}&list=1`).then(result=>result.entries));return listCache.get(directory)!},
  }
}

export function createOverlaySourceReader(base:SourceReader,overrides:Map<string,string>):SourceReader{
  return {
    async readText(file:string):Promise<string>{return overrides.has(file)?overrides.get(file)!:base.readText(file)},
    async list(directory:string):Promise<string[]>{
      const children=await base.list(directory)
      const prefix=directory.replace(/\/$/,'')+'/'
      const added=[...overrides.keys()].filter(file=>file.startsWith(prefix)).map(file=>file.slice(prefix.length).split('/')[0])
      return [...new Set([...children,...added])].sort()
    },
  }
}
