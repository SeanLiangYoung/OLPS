import * as cssTree from 'css-tree'

export function rewriteCmsResourceCss(css:string,relativePath:string,resourceBaseUrl:string,token:string):string{
  function signed(value:string):string{
    if(!value||value.startsWith('#'))return value
    const url=new URL(value,`https://resource.invalid/${relativePath}`)
    if(url.origin!=='https://resource.invalid')return value
    const file=decodeURIComponent(url.pathname).slice(1).replace(/^assets\/theme\/([^/]+)\//,'themes/$1/assets/').replace(/^assets\/plugin\/([^/]+)\//,'plugins/$1/assets/')
    if(value.includes('\\')||file.includes('\0')||file.split('/').some(part=>part==='.'||part==='..')||!/^(assets\/uploads\/|themes\/[^/]+\/assets\/|plugins\/[^/]+\/assets\/)/.test(file))throw new Error('RESOURCE_PATH_FORBIDDEN')
    url.searchParams.set('token',token)
    return `${resourceBaseUrl.endsWith('/')?resourceBaseUrl:resourceBaseUrl+'/'}${file.split('/').map(encodeURIComponent).join('/')}?${url.searchParams.toString()}${url.hash}`
  }
  const ast=cssTree.parse(css)
  cssTree.walk(ast,node=>{
    if(node.type==='Url')node.value=signed(node.value)
    if(node.type==='Atrule'&&node.name.toLowerCase()==='import'&&node.prelude)cssTree.walk(node.prelude,child=>{if(child.type==='String')child.value=signed(child.value)})
  })
  return cssTree.generate(ast)
}
