import {assertValidSchema} from '@olps/domain'
import type {SiteModel} from './site-model.js'
import type {SourceReader} from './source-reader.js'
export type PluginSettingDefinition={key:string;type:string;translatable?:boolean;default?:unknown;itemFields?:PluginSettingDefinition[]}
export type PluginRenderConfig={id:string;settings:Record<string,unknown>;snippets:Array<{file:string;position:'head'|'body-end';scope:'all'|'pages-with-block'}>}
export function resolvePluginSettings(fields:PluginSettingDefinition[],values:Record<string,unknown>,locale?:string):Record<string,unknown>{
  const settings:Record<string,unknown>={}
  for(const field of fields){
    if(field.type==='secret')continue
    let value=Object.hasOwn(values,field.key)?values[field.key]:field.default
    if(locale!==undefined&&field.translatable&&value&&typeof value==='object'&&!Array.isArray(value)&&!('mediaId' in value)&&!('kind' in value)&&!('type' in value))value=(value as Record<string,unknown>)[locale]??null
    if(field.type==='list'&&Array.isArray(value))value=value.map(item=>resolvePluginSettings(field.itemFields??[],item,locale))
    settings[field.key]=value??null
  }
  return settings
}
export async function loadPluginRenderConfigs(model:SiteModel,reader:SourceReader,locale:string):Promise<Record<string,PluginRenderConfig>>{
  const result:Record<string,PluginRenderConfig>={}
  for(const [id,entry]of Object.entries(model.plugins.plugins)){
    if(!entry.enabled)continue
    const manifest=JSON.parse(await reader.readText(`plugins/${id}/plugin.json`)) as {settings:PluginSettingDefinition[];snippets:PluginRenderConfig['snippets']}
    assertValidSchema('plugin',manifest,`plugins/${id}/plugin.json`)
    result[id]={id,settings:resolvePluginSettings(manifest.settings,entry.settings,locale),snippets:manifest.snippets}
  }
  return result
}
