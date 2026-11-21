import fs from 'node:fs/promises'
import path from 'node:path'
import { createDefaultSiteContent } from '@olps/domain'
import { starterThemeRoot } from '@olps/builtin-themes'
import { builtinPluginIds, pluginRoot } from '@olps/builtin-plugins'
import { installSiteBuilder, buildSite } from '@olps/site-builder'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export async function bootstrapCmsSite(root: string, siteId: string, publicApiBaseUrl: string, siteName: string): Promise<string> {
  const content = createDefaultSiteContent()
  content.settings.siteName = siteName
  content.settings.siteUrl = `${publicApiBaseUrl}/p/${siteId}`
  content.settings.company.name = siteName
  const gitOrThrow = (directory: string, args: string[]) => execFileSync('git',args,{cwd:directory,encoding:'utf8'}).trim()
  await fs.mkdir(root, {recursive:true})
  gitOrThrow(root,['init','-b','main'])
  const write = async (file: string, value: unknown) => {
    await fs.mkdir(path.dirname(path.join(root,file)), {recursive:true})
    await fs.writeFile(path.join(root,file), `${JSON.stringify(value,null,2)}\n`)
  }
  await write('olps.manifest.json',{schemaVersion:1,verifyCommand:['node','tools/site-verify.mjs']})
  await write('source/site-settings.json',content.settings)
  await write('source/appearance.json',content.appearance)
  await write('source/plugins.json',content.plugins)
  await write('source/redirects.json',{schemaVersion:1,redirects:[]})
  await write('source/publish-config.json',{schemaVersion:1,siteId,publicSiteUrl:`${publicApiBaseUrl}/p/${siteId}`,publicApiBaseUrl,hostingBasePath:'/',connectors:{},conversionSettings:{submitInquiry:false,qualifiedInquiry:false},indexNowKey:randomUUID().replaceAll('-','')})
  for (const page of content.pages) {
    await write(`source/pages/${page.meta.pageId}/page.json`,page.meta)
    for (const [locale,file] of Object.entries(page.locales)) await write(`source/pages/${page.meta.pageId}/${locale}.json`,file)
  }
  for (const definition of content.collections) {
    await write(`source/collections/${definition.collectionId}.json`,definition)
    for (const locale of content.settings.locales) {
      await write(`source/collections/${definition.collectionId}/index/${locale.code}.json`,{schemaVersion:1,locale:locale.code,title:definition.name,summary:'',cover:null,seo:{title:definition.name,description:definition.name,ogImage:null},blocks:[{id:`${definition.collectionId}-${locale.code}`,type:'core/collection-list',props:{source:'current',pageSize:24,sort:'manual'},children:[]}],sourceHash:null,updatedAt:new Date().toISOString()})
    }
  }
  for (const locale of content.settings.locales) await write(`source/i18n/${locale.code}.json`,{schemaVersion:1,strings:{}})
  for (const directory of ['assets/uploads','source/media']) {
    await fs.mkdir(path.join(root,directory),{recursive:true})
    await fs.writeFile(path.join(root,directory,'.gitkeep'),'')
  }
  await fs.cp(starterThemeRoot,path.join(root,'themes/starter'),{recursive:true})
  for (const id of builtinPluginIds) await fs.cp(pluginRoot(id),path.join(root,'plugins',id),{recursive:true})
  await fs.writeFile(path.join(root,'.gitignore'),'.olps-cache/\n')
  await installSiteBuilder(root)
  await buildSite(root)
  gitOrThrow(root,['add','-A'])
  gitOrThrow(root,['-c','user.name=OLPS','-c','user.email=olps@localhost','commit','-m','创建默认网站'])
  return gitOrThrow(root,['rev-parse','HEAD'])
}
