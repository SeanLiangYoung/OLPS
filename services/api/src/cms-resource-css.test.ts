import { expect,it } from 'vitest'
import * as cssTree from 'css-tree'
import { rewriteCmsResourceCss } from './cms-resource-css.js'

it('CSS导入与图片字体地址均带资源签名，保留查询和SVG片段',()=>{
  const css='@import "nested/layout.css";@import url("../assets/colors.css");@font-face{src:url("fonts/site.woff2?v=2")} .hero{background:url("/assets/uploads/a.svg#shape")} .built{background:url("/assets/theme/starter/image.png")} '
  const result=rewriteCmsResourceCss(css,'themes/starter/assets/site.css','/api/drafts/draft/resources/','access-token')
  const values:string[]=[]
  cssTree.walk(cssTree.parse(result),node=>{if(node.type==='Url')values.push(node.value);if(node.type==='String')values.push(node.value)})
  expect(values).toEqual(expect.arrayContaining(['/api/drafts/draft/resources/themes/starter/assets/nested/layout.css?token=access-token','/api/drafts/draft/resources/themes/starter/assets/colors.css?token=access-token','/api/drafts/draft/resources/themes/starter/assets/fonts/site.woff2?v=2&token=access-token','/api/drafts/draft/resources/assets/uploads/a.svg?token=access-token#shape','/api/drafts/draft/resources/themes/starter/assets/image.png?token=access-token']))
})

it('保留外部地址、data和片段，拒绝受管目录之外的相对地址',()=>{
  const result=rewriteCmsResourceCss('.a{background:url("data:image/png;base64,AA")} .b{background:url("https://cdn.example/a.png")} .c{filter:url(#blur)}','plugins/form/assets/theme.css','/resources/','token')
  expect(result).toContain('data:image/png;base64,AA');expect(result).toContain('https://cdn.example/a.png');expect(result).toContain('#blur')
  for(const source of ['url("../../plugin.json")','url("/source/site-settings.json")','url("/themes/starter/assets/%2e%2e%2fsecret.json")'])expect(()=>rewriteCmsResourceCss(`.a{background:${source}}`,'themes/starter/assets/site.css','/resources/','token')).toThrow('RESOURCE_PATH_FORBIDDEN')
})
