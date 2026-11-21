import type { ConsentState,TrackingConfig } from './types.js'
import { on } from './events.js'
import { getAttribution } from './attribution.js'

const eventNames=new Set(['page_view','form_start','inquiry_submit','phone_click','email_click','whatsapp_click','download_click','outbound_click','scroll_depth'])

export function installNativeEvents(config:TrackingConfig,getConsent:()=>ConsentState):void{
  const collector=config.eventCollector
  if(!collector)return
  on('*',body=>{
    const {event,event_id,pageViewCategory,...payload}=body
    if(!getConsent().analytics||!eventNames.has(String(event))||event==='page_view'&&pageViewCategory==='advertising')return
    void fetch(collector.endpoint,{method:'POST',credentials:'omit',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:event_id,name:event,target:collector.target,locale:config.locale,payload:{...payload,attribution:getAttribution()}})}).then(response=>{
      if(!response.ok)throw new Error(`原生统计请求失败：HTTP ${response.status}`)
    }).catch(error=>{console.error(error)})
  })
}
