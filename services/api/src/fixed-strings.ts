import type { ContentContext } from './content-sandbox.js'
export async function packageFixedStrings(context: ContentContext, locale: string): Promise<Record<string,string>> {
  const strings:Record<string,string>={}
  for(const kind of ['themes','plugins'])for(const file of await context.workspace.listFiles(kind)) {
    const parts=file.split('/')
    if(parts.length!==4||parts[2]!=='languages'||parts[3]!==`${locale}.json`)continue
    const table=JSON.parse((await context.workspace.readFile(file)).toString()) as {strings:Record<string,string>}
    for(const [key,value] of Object.entries(table.strings))strings[`${kind==='themes'?'theme':'plugin'}:${parts[1]}:${key}`]=value
  }
  return strings
}
