import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import MarkdownIt from 'markdown-it'
import GithubSlugger from 'github-slugger'
import {parseFragment} from 'parse5'

const markdown=new MarkdownIt({html:true})
const origin='https://documentation.invalid'
async function exists(file){try{await fs.stat(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
async function markdownFiles(directory){
  if(!await exists(directory))return []
  const files=[]
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    if(entry.name==='node_modules'||entry.name.startsWith('.'))continue
    const file=path.join(directory,entry.name)
    if(entry.isDirectory())files.push(...await markdownFiles(file))
    else if(entry.isFile()&&entry.name.endsWith('.md'))files.push(file)
  }
  return files
}
function htmlNodes(fragment,visit){visit(fragment);if(fragment.childNodes)for(const child of fragment.childNodes)htmlNodes(child,visit)}
function nodeText(node){return node.nodeName==='#text'?node.value:(node.childNodes??[]).map(nodeText).join('')}
function inlineText(tokens){return (tokens??[]).map(token=>token.type==='text'||token.type==='code_inline'||token.type==='image'?token.content:token.type==='softbreak'||token.type==='hardbreak'?' ':token.children?inlineText(token.children):'').join('')}
function inspectMarkdown(content){
  const anchors=new Set(),links=[],slugger=new GithubSlugger(),tokens=markdown.parse(content,{})
  const inspectHtml=(html,line)=>htmlNodes(parseFragment(html,{sourceCodeLocationInfo:true}),node=>{
    if(!node.attrs)return
    for(const attr of node.attrs){if(attr.name==='id'||node.tagName==='a'&&attr.name==='name')anchors.add(attr.value);if(['href','src','poster'].includes(attr.name))links.push({href:attr.value,line:line+(node.sourceCodeLocation?.startLine??1)-1})}
    if(['h1','h2','h3','h4','h5','h6'].includes(node.tagName)&&!node.attrs.some(attr=>attr.name==='id'))anchors.add(slugger.slug(nodeText(node)))
  })
  const inspectInline=(children,line)=>{for(const child of children??[]){if(child.type==='link_open'||child.type==='image'){const href=child.attrGet(child.type==='image'?'src':'href');if(href!==null)links.push({href,line})}if(child.type==='html_inline')inspectHtml(child.content,line);if(child.children)inspectInline(child.children,line)}}
  for(let index=0;index<tokens.length;index++){
    const token=tokens[index],line=(token.map?.[0]??0)+1
    if(token.type==='heading_open')anchors.add(slugger.slug(inlineText(tokens[index+1]?.children)))
    if(token.type==='inline')inspectInline(token.children,line)
    if(token.type==='html_block')inspectHtml(token.content,line)
  }
  return {anchors,links}
}
export async function checkDocumentation(root){
  root=path.resolve(root)
  const files=new Set([...await markdownFiles(path.join(root,'docs')),...await markdownFiles(path.join(root,'services/api/docs'))])
  if(await exists(path.join(root,'README.md')))files.add(path.join(root,'README.md'))
  for(const directory of ['packages','services','apps']){
    const base=path.join(root,directory)
    if(!await exists(base))continue
    for(const entry of await fs.readdir(base,{withFileTypes:true}))if(entry.isDirectory()&&await exists(path.join(base,entry.name,'README.md')))files.add(path.join(base,entry.name,'README.md'))
  }
  const cache=new Map(),failures=[]
  const inspect=async file=>{if(!cache.has(file))cache.set(file,inspectMarkdown(await fs.readFile(file,'utf8')));return cache.get(file)}
  let checkedLinks=0
  for(const file of [...files].sort()){
    const source=await inspect(file)
    const base=new URL(path.relative(root,file).split(path.sep).map(encodeURIComponent).join('/'),`${origin}/`)
    for(const link of source.links){
      if(!link.href)continue
      let url,target,fragment
      try{url=new URL(link.href,base);if(url.protocol==='file:')target=fileURLToPath(url);else{if(url.origin!==origin)continue;target=path.resolve(root,`.${decodeURIComponent(url.pathname)}`)}fragment=decodeURIComponent(url.hash.slice(1))}catch{failures.push({file:path.relative(root,file),...link,reason:'链接地址格式无效'});continue}
      checkedLinks++
      if(target!==root&&!target.startsWith(root+path.sep)){failures.push({file:path.relative(root,file),...link,reason:'本地链接超出仓库目录'});continue}
      if(!await exists(target)){failures.push({file:path.relative(root,file),...link,reason:'本地文件不存在'});continue}
      if(!fragment)continue
      if((await fs.stat(target)).isDirectory())target=path.join(target,'README.md')
      if(!target.endsWith('.md'))continue
      if(!await exists(target)||!(await inspect(target)).anchors.has(fragment))failures.push({file:path.relative(root,file),...link,reason:`Markdown 标题或显式锚点不存在：${fragment}`})
    }
  }
  return {files:files.size,checkedLinks,failures}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await checkDocumentation(process.cwd())
  for(const failure of result.failures)console.error(`${failure.file}:${failure.line} ${failure.href} — ${failure.reason}`)
  console.log(`已检查 ${result.files} 份文档、${result.checkedLinks} 个本地链接；失效链接 ${result.failures.length} 个。`)
  if(result.failures.length)process.exitCode=1
}
