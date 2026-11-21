import { createSanitizeDocument } from '#sanitize-document'

export function inspectSeo(html:string,title:string,description:string,otherTitles:string[]):string[]{
  const messages:string[]=[]
  const document=createSanitizeDocument()
  document.documentElement.innerHTML=html
  if(!title.trim())messages.push('请填写搜索结果标题。')
  else if(title.length>60)messages.push('搜索结果标题较长，请控制在60个字符以内。')
  if(!description.trim())messages.push('请填写搜索结果摘要。')
  else if(description.length>160)messages.push('搜索结果摘要较长，请控制在160个字符以内。')
  if(document.querySelectorAll('h1').length!==1)messages.push('页面需要保留一个主标题。')
  let level=0
  for(const heading of document.querySelectorAll('h1,h2,h3,h4,h5,h6')){const next=Number(heading.tagName.slice(1));if(level&&next>level+1){messages.push('标题层级有跳跃，请按主标题、小标题的顺序排列。');break}level=next}
  if([...document.querySelectorAll('img')].some(image=>!image.alt.trim()))messages.push('部分图片缺少替代文字，请补充图片说明。')
  if(otherTitles.some(other=>other.trim()===title.trim()))messages.push('搜索结果标题与其他内容重复，请使用容易区分的标题。')
  if((document.body.textContent??'').trim().length<200)messages.push('正文内容较少，可以补充介绍、参数或常见问题。')
  return messages
}
