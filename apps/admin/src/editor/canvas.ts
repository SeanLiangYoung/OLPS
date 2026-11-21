import * as cssTree from 'css-tree'
import { parseSrcset,stringifySrcset } from 'srcset'
import type { MediaMeta } from '@olps/domain'
import type { SourceReader } from '@olps/render'

export type ResourceAccess={token:string;resourceBaseUrl:string;expiresAt:string}

function resourcePath(value:string,from=''):string|null{
  const url=new URL(value,`https://source.invalid/${from}`)
  if(url.origin!=='https://source.invalid')return null
  let file=decodeURIComponent(url.pathname).slice(1)
  file=file.replace(/^assets\/theme\/([^/]+)\//,'themes/$1/assets/').replace(/^assets\/plugin\/([^/]+)\//,'plugins/$1/assets/')
  return /^(assets\/uploads\/|themes\/[^/]+\/assets\/|plugins\/[^/]+\/assets\/)/.test(file)?file:null
}

export function signedResourceUrl(file:string,access:ResourceAccess):string{
  return new URL(`${access.resourceBaseUrl}${file.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(access.token)}`,location.origin).href
}

export async function createCanvasDocument(html:string,reader:SourceReader,access:ResourceAccess,media:MediaMeta[],selectedId:string):Promise<string>{
  const document=new DOMParser().parseFromString(html,'text/html')
  function url(value:string,from=''):string{
    const file=resourcePath(value,from)
    if(!file)return value
    const original=media.find(item=>{
      const dot=item.path.lastIndexOf('.')
      const stem=item.path.slice(0,dot)
      const extension=item.path.slice(dot)
      return [480,960,1440,1920].some(width=>file===`${stem}-${width}w${extension}`)
    })
    return signedResourceUrl(original?.path??file,access)
  }
  function css(source:string,from:string,context:'stylesheet'|'declarationList'='stylesheet'):string{
    const ast=cssTree.parse(source,{context})
    cssTree.walk(ast,node=>{
      if(node.type==='Url')node.value=url(node.value,from)
      if(node.type==='Atrule'&&node.name.toLowerCase()==='import'&&node.prelude)cssTree.walk(node.prelude,child=>{if(child.type==='String')child.value=url(child.value,from)})
    })
    return cssTree.generate(ast)
  }
  for(const link of [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]){
    const file=resourcePath(link.getAttribute('href')??'')
    if(!file)continue
    const style=document.createElement('style')
    style.textContent=css(await reader.readText(file),file)
    link.replaceWith(style)
  }
  for(const element of [...document.querySelectorAll<HTMLElement>('*')]){
    for(const attribute of [...element.attributes]){
      if(['src','poster','data'].includes(attribute.name))element.setAttribute(attribute.name,url(attribute.value))
      if(attribute.name==='srcset')element.setAttribute(attribute.name,stringifySrcset(parseSrcset(attribute.value).map(entry=>({...entry,url:url(entry.url)}))))
      if(attribute.name==='style')element.setAttribute('style',css(attribute.value,'','declarationList'))
    }
    if(element.tagName==='STYLE'&&element.textContent)element.textContent=css(element.textContent,'')
    if(element.dataset.olpsBlock===selectedId)element.dataset.editorSelected='true'
  }
  for(const element of document.querySelectorAll('script,base'))element.remove()
  for(const element of document.querySelectorAll('meta[http-equiv]'))if(['refresh','content-security-policy'].includes(element.getAttribute('http-equiv')!.toLowerCase()))element.remove()
  const csp=document.createElement('meta')
  csp.httpEquiv='Content-Security-Policy'
  document.head.prepend(csp)
  const style=document.createElement('style')
  style.textContent='[data-olps-block]{cursor:pointer}[data-olps-block]:hover{outline:1px dashed #3974a5}[data-editor-selected]{outline:2px solid #1464a5;outline-offset:3px}[contenteditable=true]{cursor:text;outline:2px solid #1464a5}'
  document.head.append(style)
  const bridge=document.createElement('script')
  bridge.textContent=`window.addEventListener('message',function(event){if(event.source!==parent||!event.data||event.data.type!=='olps-editor-highlight')return;document.querySelectorAll('[data-olps-block]').forEach(function(block){if(block.dataset.olpsBlock===event.data.blockId)block.dataset.editorSelected='true';else delete block.dataset.editorSelected})});document.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();var block=event.target.closest('[data-olps-block]');if(block)parent.postMessage({type:'olps-editor-select',blockId:block.dataset.olpsBlock},'*')},true);document.addEventListener('dblclick',function(event){var element=event.target.closest('h1,h2,h3,h4,h5,h6');var block=element&&element.closest('[data-olps-block-type="core/heading"]');if(!block)return;element.contentEditable='true';element.focus();element.addEventListener('blur',function(){element.contentEditable='false';parent.postMessage({type:'olps-editor-heading',blockId:block.dataset.olpsBlock,value:element.textContent},'*')},{once:true})},true);`
  document.body.append(bridge)
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bridge.textContent))
  const hash=btoa(String.fromCharCode(...new Uint8Array(digest)))
  csp.content=`default-src 'none'; img-src http: https: data: blob:; style-src 'unsafe-inline' http: https:; font-src http: https: data:; media-src http: https: blob:; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-src 'none'`
  return '<!doctype html>'+document.documentElement.outerHTML
}
