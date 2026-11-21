import { createParser } from 'eventsource-parser'
import { getAccessToken } from '../api'

export type EditorJobEvent={eventId:number;type:string;payload:Record<string,unknown>}
export async function watchEditorJob(jobId:string,onEvent:(event:EditorJobEvent)=>void,signal:AbortSignal,after=0):Promise<void>{
  const token=getAccessToken()
  if(!token)throw new Error('请重新登录。')
  let last=after
  let terminal=false
  async function reconnect():Promise<void>{await new Promise<void>(resolve=>{if(signal.aborted){resolve();return}const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},500);function abort(){clearTimeout(timer);resolve()}signal.addEventListener('abort',abort,{once:true})})}
  while(!terminal&&!signal.aborted){
    let response:Response
    try{response=await fetch(`/api/jobs/${encodeURIComponent(jobId)}/events`,{headers:{Authorization:`Bearer ${token}`,'Last-Event-ID':String(last)},signal})}
    catch(error){if(signal.aborted)return;if(!(error instanceof TypeError))throw error;await reconnect();continue}
    if(!response.ok||!response.body)throw new Error('无法读取生成进度。')
    const parser=createParser({onEvent:event=>{
      const value=JSON.parse(event.data) as EditorJobEvent
      if(value.eventId<=last)return
      last=value.eventId
      terminal=['job_completed','job_failed'].includes(value.type)
      onEvent(value)
    }})
    const reader=response.body.getReader()
    const decoder=new TextDecoder()
    try{while(!terminal){let next:ReadableStreamReadResult<Uint8Array>;try{next=await reader.read()}catch(error){if(signal.aborted)return;if(error instanceof TypeError)break;throw error}if(next.done)break;parser.feed(decoder.decode(next.value,{stream:true}))}parser.feed(decoder.decode())}
    finally{await reader.cancel();reader.releaseLock()}
    if(!terminal)await reconnect()
  }
}
