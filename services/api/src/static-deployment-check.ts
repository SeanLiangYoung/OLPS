import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import {createHash,randomUUID} from 'node:crypto'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {createRequire} from 'node:module'
import archiver from 'archiver'
import sharp from 'sharp'
import {chromium,type Browser} from '@playwright/test'
import {buildSite,loadWorkspace,planServerConfig,verifySite} from '@olps/site-builder'
import {bootstrapCmsSite} from './cms-site-bootstrap.js'

const execute=promisify(execFile),repo=path.resolve(import.meta.dirname,'../../..')
const output=path.join(repo,'.intermediate/static-deployment',new Date().toISOString().replaceAll(':','-'))
const containers:string[]=[]
let serveProcess:ChildProcess|undefined,browser:Browser|undefined
const results:Array<Record<string,unknown>>=[]
const sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
async function write(root:string,file:string,value:unknown):Promise<void>{
  const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(value,null,2)+'\n')
}
async function artifacts(root:string,relative=''):Promise<Array<{path:string;sha256:string}>>{
  const files:Array<{path:string;sha256:string}>=[]
  for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
    const file=path.posix.join(relative,entry.name)
    assert.equal(entry.isSymbolicLink(),false,`产物包含符号链接：${file}`)
    if(entry.isDirectory())files.push(...await artifacts(root,file))
    else{assert.ok(entry.isFile());files.push({path:file,sha256:sha256(await fs.readFile(path.join(root,file)))})}
  }
  return files.sort((a,b)=>a.path.localeCompare(b.path))
}
async function availablePort():Promise<number>{
  const server=net.createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port
}
async function ready(url:string):Promise<void>{
  const deadline=Date.now()+30000
  while(Date.now()<deadline){
    try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return}catch(error){if(serveProcess?.exitCode!==null&&serveProcess?.exitCode!==undefined)throw error}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error(`静态服务启动超时：${url}`)
}
async function nginx(name:string,publicRoot:string,serverConfig:string,prefix:string,port:number):Promise<string>{
  const conf=path.join(output,`${name}.conf`)
  const location=prefix?`location ${prefix}/ { alias /usr/share/nginx/html/; index index.html; }\nlocation / { return 404; }`:'location / { try_files $uri $uri/ =404; }'
  await fs.writeFile(conf,`server { listen 80; server_name localhost; absolute_redirect off; root /usr/share/nginx/html; include /etc/olps/nginx.conf; ${location} }\n`)
  const container=`olps-static-${name}-${randomUUID().slice(0,8)}`
  await execute('docker',['run','--detach','--rm','--name',container,'--publish',`127.0.0.1:${port}:80`,'--mount',`type=bind,src=${publicRoot},dst=/usr/share/nginx/html,readonly`,'--mount',`type=bind,src=${conf},dst=/etc/nginx/conf.d/default.conf,readonly`,'--mount',`type=bind,src=${serverConfig},dst=/etc/olps/nginx.conf,readonly`,'nginx:1.28-alpine'])
  containers.push(container)
  const address=(await execute('docker',['port',container,'80/tcp'])).stdout.trim()
  const base=`http://${address}${prefix}`;await ready(`${base}/en/`);return base
}
async function checkHost(label:string,base:string,files:Array<{path:string;sha256:string}>,nativeRedirects:boolean):Promise<void>{
  const prefix=new URL(base).pathname.replace(/\/$/,'')
  const page=await browser!.newPage(),responses:Array<{url:string;status:number}>=[],failedRequests:string[]=[]
  page.on('response',response=>{if(response.url().startsWith(base))responses.push({url:response.url(),status:response.status()})})
  page.on('requestfailed',request=>failedRequests.push(`${request.url()} ${request.failure()?.errorText}`))
  try{
    for(const file of files){const response=await fetch(`${base}/${file.path.split('/').map(encodeURIComponent).join('/')}`);assert.equal(response.status,200,`${label}/${file.path}`);assert.equal(sha256(Buffer.from(await response.arrayBuffer())),file.sha256,`${label}/${file.path}摘要不一致`)}
    for(const route of ['en/','zh-CN/','en/products/','en/products/page/2/','en/products/industrial-1/','zh-CN/products/industrial-1/']){
      const response=await page.goto(`${base}/${route}`);assert.equal(response?.status(),200,`${label}/${route}`);assert.equal(await page.locator('main').count(),1)
      assert.equal(await page.locator('html').getAttribute('lang'),route.startsWith('zh-CN/')?'zh-CN':'en')
      if(route.includes('/products/'))assert.equal(await page.locator('h1').count(),1,`${label}/${route}主标题`)
      assert.equal(await page.locator('link[rel="canonical"]').count(),1);assert.ok(await page.locator('link[hreflang="zh-CN"]').count())
    }
    const campaign='?utm_source=redirect-check&gclid=redirect-click#campaign'
    const assertCampaign=(url:URL)=>{assert.equal(url.searchParams.get('utm_source'),'redirect-check');assert.equal(url.searchParams.get('gclid'),'redirect-click');assert.equal(url.hash,'#campaign')}
    for(const route of ['en/old-industrial/','en/previous/product/']){
      const response=await fetch(`${base}/${route}${campaign}`,{redirect:'manual'})
      assert.equal(response.status,nativeRedirects?301:200,`${label}跳转状态`)
      if(nativeRedirects){const destination=new URL(response.headers.get('location')!,base);assert.equal(destination.pathname,`${prefix}/en/products/industrial-1/`);assert.equal(destination.searchParams.get('utm_source'),'redirect-check');assert.equal(destination.searchParams.get('gclid'),'redirect-click')}
      await page.goto(`${base}/${route}${campaign}`);await page.waitForURL(url=>url.pathname===`${prefix}/en/products/industrial-1/`);assertCampaign(new URL(page.url()))
    }
    const rootResponse=await fetch(`${base}/${campaign}`,{redirect:'manual'});assert.equal(rootResponse.status,200)
    await page.goto(`${base}/${campaign}`);await page.waitForURL(url=>url.pathname===`${prefix}/en/`);assertCampaign(new URL(page.url()))
    const missing=await page.goto(`${base}/missing-${randomUUID()}/`);assert.equal(missing?.status(),404);assert.match(await page.locator('body').innerText(),/not found|找不到|不存在|未找到/i)
    for(const hidden of ['sitemap.xml','sitemap-pages.xml','robots.txt','llms.txt','en/llms-full.txt','zh-CN/llms-full.txt','en/news/feed.xml','en/index.md'])assert.equal((await fetch(`${base}/${hidden}`)).status,200,`${label}/${hidden}`)
    for(const forbidden of ['.git/config','source/site-settings.json','server-config/nginx.conf'])assert.equal((await fetch(`${base}/${forbidden}`)).status,404,`${label}/${forbidden}`)
    await page.goto(`${base}/en/products/industrial-1/`)
    assert.equal(await page.locator('h1').innerText(),'Industrial 1')
    assert.ok(await page.locator('img').count())
    await page.locator('img').first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>Array.from(document.images).every(image=>image.complete&&image.naturalWidth>0))
    const reject=page.getByRole('button',{name:/拒绝|Reject/i});if(await reject.isVisible())await reject.click()
    await page.locator('a[hreflang="zh-CN"]').first().click();await page.waitForURL(url=>url.pathname===`${prefix}/zh-CN/products/industrial-1/`)
    assert.equal(await page.locator('h1').innerText(),'工业产品 1')
    const search=await page.evaluate(async url=>{
      const module=await import(url) as {search(query:string):Promise<{results:Array<{data():Promise<{url:string}>}>}>}
      const result=await module.search('industrial');return{count:result.results.length,first:result.results[0]?await result.results[0].data():null}
    },`${base}/pagefind/pagefind.js`)
    assert.ok(search.count>0,`${label}搜索结果为空`);assert.ok(search.first?.url)
    const searchTarget=new URL(search.first!.url,`${base}/`);assert.ok(searchTarget.pathname.startsWith(`${prefix}/`))
    assert.equal((await page.goto(searchTarget.href))?.status(),200);assert.equal(await page.locator('h1').count(),1)
    const broken=responses.filter(response=>response.status>=400&&!response.url.includes('missing-')&&!response.url.includes('/.git/')&&!response.url.includes('/source/')&&!response.url.includes('/server-config/'))
    assert.deepEqual(broken,[],`${label}页面资源加载失败`)
    assert.deepEqual(failedRequests.filter(request=>!request.includes('net::ERR_ABORTED')),[],`${label}请求失败`)
    results.push({label,base,status:'completed',verifiedFiles:files.length,searchResults:search.count,nativeRedirects,campaignRedirects:3,domResponses:responses.length})
    console.log(`${label}：${files.length}个文件摘要、多语言、分页、详情、搜索、404与两条跳转检查通过`)
  }finally{await page.close()}
}
async function run():Promise<void>{
  await fs.mkdir(output,{recursive:true});const workspace=path.join(output,'workspace'),siteId=randomUUID(),now=new Date().toISOString(),collectionId='22222222-2222-4222-8222-222222222202',mediaId=randomUUID(),rootPort=await availablePort(),subPort=await availablePort(),servePort=await availablePort()
  await bootstrapCmsSite(workspace,siteId,'http://127.0.0.1:8787','Static deployment acceptance')
  const settings=JSON.parse(await fs.readFile(path.join(workspace,'source/site-settings.json'),'utf8'));settings.siteUrl=`http://127.0.0.1:${rootPort}`;await write(workspace,'source/site-settings.json',settings)
  const publish=JSON.parse(await fs.readFile(path.join(workspace,'source/publish-config.json'),'utf8'));publish.publicSiteUrl=settings.siteUrl;await write(workspace,'source/publish-config.json',publish)
  const image=await sharp({create:{width:800,height:450,channels:3,background:'#347ca8'}}).png().toBuffer(),imagePath='assets/uploads/2026/11/industrial.png'
  await fs.mkdir(path.dirname(path.join(workspace,imagePath)),{recursive:true});await fs.writeFile(path.join(workspace,imagePath),image)
  await write(workspace,`source/media/${mediaId}.json`,{schemaVersion:1,mediaId,path:imagePath,mimeType:'image/png',size:image.length,width:800,height:450,title:{en:'Industrial image','zh-CN':'工业图片'},alt:{en:'Industrial image','zh-CN':'工业图片'},caption:{en:'','zh-CN':''},uploadedBy:'deployment-check',uploadedAt:now,updatedAt:now})
  for(const locale of ['en','zh-CN']){
    const indexFile=`source/collections/${collectionId}/index/${locale}.json`,index=JSON.parse(await fs.readFile(path.join(workspace,indexFile),'utf8'));index.blocks[0].props.pageSize=3;await write(workspace,indexFile,index)
  }
  for(let number=1;number<=8;number++){
    const itemId=randomUUID(),directory=`source/collections/${collectionId}/items/${itemId}`
    await write(workspace,`${directory}/item.json`,{schemaVersion:1,itemId,status:'published',primaryGroupId:null,groupIds:[],order:number,publishedAt:now,fields:{model:`IND-${number}`,gallery:[{mediaId}]},createdAt:now,updatedAt:now})
    for(const locale of ['en','zh-CN']){
      const title=locale==='en'?`Industrial ${number}`:`工业产品 ${number}`
      await write(workspace,`${directory}/${locale}.json`,{schemaVersion:1,locale,slug:`industrial-${number}`,title,summary:title,cover:{mediaId},seo:{title,description:title,ogImage:{mediaId}},blocks:[{id:`description-${number}-${locale}`,type:'core/html',props:{html:`<p>${title} industrial export validation.</p>`},children:[]},{id:`image-${number}-${locale}`,type:'core/image',props:{image:{mediaId},alt:title},children:[]}],sourceHash:null,updatedAt:now,fields:{specifications:[{name:'Model',value:`IND-${number}`}]}})
    }
  }
  const loaded=await loadWorkspace(workspace),first=loaded.model.collections.find(collection=>collection.definition.collectionId===collectionId)!.items.find(item=>item.meta.order===1)!
  await write(workspace,'source/redirects.json',{schemaVersion:1,redirects:['/en/old-industrial/','/en/previous/product/'].map(from=>({redirectId:randomUUID(),from,locale:'en',target:{ref:'item',id:first.meta.itemId},createdAt:now}))})
  await buildSite(workspace);await verifySite(workspace)
  const zip=path.join(output,'website.zip'),stream=createWriteStream(zip),archive=archiver('zip',{zlib:{level:9}})
  const closed=new Promise<void>((resolve,reject)=>{stream.on('close',resolve);stream.on('error',reject);archive.on('error',reject)})
  archive.pipe(stream);archive.directory(path.join(workspace,'public'),'public');archive.directory(path.join(workspace,'server-config'),'server-config');await archive.finalize();await closed
  const extracted=path.join(output,'extracted');await fs.mkdir(extracted);await execute('unzip',['-q',zip,'-d',extracted])
  for(const config of ['nginx.conf','web.config','.htaccess','_redirects'])assert.ok((await fs.stat(path.join(extracted,'server-config',config))).isFile())
  const publicRoot=path.join(extracted,'public'),files=await artifacts(publicRoot);assert.deepEqual(files,await artifacts(path.join(workspace,'public')))
  await write(output,'artifact-manifest.json',{zipSha256:sha256(await fs.readFile(zip)),files})
  const model=(await loadWorkspace(workspace)).model;model.publishConfig.hostingBasePath='/catalog/'
  const subConfig=planServerConfig(model).find(file=>file.relativePath==='server-config/nginx.conf')!
  const subConfigFile=path.join(output,'subdirectory-nginx.conf');await fs.writeFile(subConfigFile,subConfig.content)
  await execute('docker',['pull','nginx:1.28-alpine'],{maxBuffer:1024*1024})
  const rootBase=await nginx('root',publicRoot,path.join(extracted,'server-config/nginx.conf'),'',rootPort),subBase=await nginx('subdirectory',publicRoot,subConfigFile,'/catalog',subPort)
  const serveCli=createRequire(import.meta.url).resolve('serve/build/main.js'),serveLog=createWriteStream(path.join(output,'serve.log'))
  serveProcess=spawn(process.execPath,[serveCli,publicRoot,'--listen',`tcp://127.0.0.1:${servePort}`,'--no-clipboard'],{stdio:['ignore','pipe','pipe']});serveProcess.stdout!.pipe(serveLog);serveProcess.stderr!.pipe(serveLog)
  const serveBase=`http://127.0.0.1:${servePort}`;await ready(`${serveBase}/en/`)
  browser=await chromium.launch({headless:true})
  await checkHost('nginx-root',rootBase,files,true);await checkHost('nginx-subdirectory',subBase,files,true);await checkHost('serve',serveBase,files,false)
  assert.deepEqual(await artifacts(publicRoot),files,'部署后文件摘要发生变化')
  const nginxDigest=(await execute('docker',['image','inspect','--format','{{index .RepoDigests 0}}','nginx:1.28-alpine'])).stdout.trim()
  const nginxVersion=(await execute('docker',['exec',containers[0]!,'nginx','-v'])).stderr.trim()
  const serveVersion=JSON.parse(await fs.readFile(createRequire(import.meta.url).resolve('serve/package.json'),'utf8')).version
  await write(output,'results.json',{status:'completed',zip,zipSha256:sha256(await fs.readFile(zip)),runtime:{nginxDigest,nginxVersion,serveVersion,chromiumVersion:browser.version()},results,unverified:['Windows/IIS','S3 static website endpoint','OSS','COS']})
  console.log(`部署验收记录：${output}`)
}
try{await run()}catch(error){await fs.mkdir(output,{recursive:true});await write(output,'results.json',{status:'failed',error:error instanceof Error?error.message:String(error),results});console.error(error);process.exitCode=1}
finally{
  if(browser)await browser.close()
  if(serveProcess&&serveProcess.exitCode===null){serveProcess.kill('SIGTERM');await new Promise<void>(resolve=>serveProcess!.once('exit',()=>resolve()))}
  for(const container of containers)await execute('docker',['rm','--force',container])
}
