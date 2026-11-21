import { expect,test } from '@playwright/test'
import { cmsWebsite,selectCmsWebsite } from './cms-fixtures'

const apiBase=process.env.OLPS_API_URL??'http://127.0.0.1:8787'
test.use({actionTimeout:15000})

test('四类内容的新建、筛选、编辑和引用保护，以及两层分组排序',async({page,request})=>{
  const site=await cmsWebsite(request,apiBase)
  await selectCmsWebsite(page,site)
  const base=`${apiBase}/api/drafts/${site.draftId}`
  const headers=site.identity.headers
  const create=async(path:string,label:string,title:string,slug:string,parent?:string)=>{
    await page.goto(path)
    if(label==='分组')await page.getByRole('button',{name:'分组',exact:true}).click()
    await page.getByRole('button',{name:`新建${label}`,exact:true}).click()
    const dialog=page.getByRole('dialog')
    await dialog.getByLabel('标题',{exact:true}).fill(title)
    await dialog.getByLabel('网址名称',{exact:true}).fill(slug)
    if(parent)await dialog.getByRole('combobox',{name:/^上级分组/}).selectOption(parent)
    await dialog.getByRole('button',{name:'创建并编辑',exact:true}).click()
    await expect(page).toHaveURL(/\/content\/(page|collection|group|item)\//)
    await expect(page.getByLabel('标题',{exact:true})).toHaveValue(title)
    return new URL(page.url()).pathname.split('/').at(-1)!
  }
  const pageId=await create('/pages','页面','验收页面','acceptance-page')
  const collectionId=await create('/collections','内容类型','验收内容类型','acceptance-products')
  const definition=await(await request.get(`${base}/content/collection/${collectionId}?locale=en`,{headers})).json()
  definition.content.meta.levels=[{levelId:crypto.randomUUID(),name:'系列'},{levelId:crypto.randomUUID(),name:'类别'}]
  const saved=await request.put(`${base}/content/collection/${collectionId}`,{headers:{...headers,'If-Match':`"${definition.revision}"`},data:definition.content})
  expect(saved.ok(),await saved.text()).toBe(true)
  const collectionPath=`/collections/${collectionId}`
  const rootA=await create(collectionPath,'分组','根分组甲','root-a')
  await create(collectionPath,'分组','根分组乙','root-b')
  const childA=await create(collectionPath,'分组','子分组甲','child-a',rootA)
  await create(collectionPath,'分组','子分组乙','child-b',rootA)
  const itemId=await create(collectionPath,'条目','验收条目','acceptance-item')
  const references=[{ref:'page',id:pageId},{ref:'collection',id:collectionId},{ref:'group',id:childA},{ref:'item',id:itemId}]
  const homeId='11111111-1111-4111-8111-111111111101'
  const home=await(await request.get(`${base}/content/page/${homeId}?locale=en`,{headers})).json()
  home.content.locale.blocks.push(...references.map(target=>({id:crypto.randomUUID(),type:'core/button',props:{label:'验收引用',link:{kind:'internal',target}},children:[]})))
  const linked=await request.put(`${base}/content/page/${homeId}`,{headers:{...headers,'If-Match':`"${home.revision}"`},data:home.content})
  expect(linked.ok(),await linked.text()).toBe(true)
  for(const entry of [
    {path:'/pages',ref:'page',title:'验收页面'},
    {path:'/collections',ref:'collection',title:'验收内容类型'},
    {path:collectionPath,ref:'group',title:'子分组甲'},
    {path:collectionPath,ref:'item',title:'验收条目'},
  ]){
    await page.goto(entry.path)
    if(entry.ref==='group')await page.getByRole('button',{name:'分组',exact:true}).click()
    await page.getByLabel('搜索内容',{exact:true}).fill(entry.title)
    const filtered=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).searchParams.get('q')===entry.title)
    await page.getByRole('button',{name:'搜索',exact:true}).click()
    expect((await filtered).ok()).toBe(true)
    const row=page.locator('tbody tr').filter({hasText:entry.title})
    await expect(row).toHaveCount(1)
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await row.getByRole('button',{name:'编辑内容',exact:true}).click()
    await expect(page.getByLabel('标题',{exact:true})).toHaveValue(entry.title)
    await page.goto(entry.path)
    if(entry.ref==='group')await page.getByRole('button',{name:'分组',exact:true}).click()
    await page.locator('tbody tr').filter({hasText:entry.title}).getByRole('button',{name:'删除',exact:true}).click()
    await page.getByRole('button',{name:'确认删除',exact:true}).click()
    await expect(page.getByRole('alert')).toContainText('此内容仍被其他位置引用')
    await page.getByRole('button',{name:'取消',exact:true}).click()
  }
  await page.goto(collectionPath)
  await page.getByRole('button',{name:'分组',exact:true}).click()
  const tree=page.locator('.panel > .cms-group-tree')
  for(const level of [tree,tree.locator(':scope > li').filter({has:page.getByRole('button',{name:'根分组甲',exact:true})}).locator(':scope > .cms-group-tree')]){
    const handles=level.locator(':scope > li > .row > .cms-group-handle')
    const before=await level.locator(':scope > li > .row > button:not(.cms-group-handle)').allTextContents()
    const reordered=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/reorder'))
    await handles.first().dragTo(handles.last())
    const response=await reordered
    expect(response.ok(),await response.text()).toBe(true)
    await expect(page.getByRole('status')).toHaveText('分组顺序已保存')
    const groups=(await(await request.get(`${base}/collections/${collectionId}/groups?locale=en`,{headers})).json()).groups as Array<{meta:{groupId:string;parentGroupId:string|null;order:number};locale:{title:string}}>
    const parent=level===tree?null:rootA
    const expected=groups.filter(group=>group.meta.parentGroupId===parent).sort((a,b)=>a.meta.order-b.meta.order).map(group=>group.locale.title)
    expect(expected).not.toEqual(before)
    await expect.poll(()=>level.locator(':scope > li > .row > button:not(.cms-group-handle)').allTextContents()).toEqual(expected)
  }
})
