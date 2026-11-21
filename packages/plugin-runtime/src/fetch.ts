import type {PluginFetchImpl} from './types.js'

export function createPluginFetch(options:{deadlineAt?:number}={}):PluginFetchImpl{
  return async(url,init)=>{
    if(init?.body&&Buffer.byteLength(init.body)>64000)throw new Error('PLUGIN_FETCH_REQUEST_TOO_LARGE')
    const remaining=(options.deadlineAt??Number.POSITIVE_INFINITY)-Date.now()
    if(remaining<=0)throw new Error('PLUGIN_FETCH_TIMEOUT')
    const response=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(4500,remaining))))})
    if(response.status>=300&&response.status<400){await response.body?.cancel();throw new Error('PLUGIN_FETCH_REDIRECT_FORBIDDEN')}
    const chunks:Uint8Array[]=[]
    let bytes=0
    if(response.body){
      const reader=response.body.getReader()
      try{
        while(true){
          const {done,value}=await reader.read()
          if(done)break
          bytes+=value.byteLength
          if(bytes>1024*1024)throw new Error('PLUGIN_FETCH_RESPONSE_TOO_LARGE')
          chunks.push(value)
        }
      }finally{await reader.cancel();reader.releaseLock()}
    }
    return{status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.concat(chunks).toString('utf8')}
  }
}
