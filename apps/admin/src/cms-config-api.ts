import { api as request,ApiError } from './api'
export {ApiError} from './api'
export const api:typeof request = async (method,path,body,options) => {
  const revision=options?.headers?.['If-Match']
  const headers=revision?.startsWith('sha256:')?{...options?.headers,'If-Match':`"${revision}"`}:options?.headers
  try { return await request(method,path,body,{...options,headers}) }
  catch(error) {
    if(!(error instanceof ApiError))throw error
    const messages:Record<string,string>={VALIDATION_FAILED:'填写内容未通过检查，请检查必填项目和格式',REVISION_CONFLICT:'网站内容已经更新，请重新打开当前页面后保存',REVISION_REQUIRED:'请重新打开当前页面后保存',FORBIDDEN:'当前账号没有执行此操作的权限',RESOURCE_IN_USE:'相关内容仍在使用此功能，请先处理使用情况',NOT_FOUND:'所选内容已经不存在',PERMISSION_CONFIRMATION_REQUIRED:'启用插件需要确认所需权限',PLUGIN_PERMISSION_CONFIRMATION_REQUIRED:'启用插件需要确认所需权限',THEME_CHANGE_REQUIRES_CONFIRMATION:'切换主题会影响当前内容，请确认影响',DRAFT_BUSY:'编辑版本正在同步，请稍后重试'}
    throw new ApiError(messages[error.code??'']??error.message,error.status,error.code,error.details)
  }
}
export async function listCmsContent<T>(base:string,plural:string,locale:string):Promise<T[]> {
  const result:T[]=[]
  let cursor:string|null=null
  do {
    const query=new URLSearchParams({locale,limit:'100'})
    if(cursor)query.set('cursor',cursor)
    const page=await api<Record<string,unknown>&{pageInfo:{nextCursor:string|null;hasNextPage:boolean}}>('GET',`${base}/${plural}?${query}`)
    result.push(...page[plural] as T[])
    cursor=page.pageInfo.hasNextPage?page.pageInfo.nextCursor:null
  } while(cursor)
  return result
}
