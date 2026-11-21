import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkDocumentation} from './check-doc-links.mjs'

test('真实 Markdown 文件中的引用链接、标题锚点、HTML 与本地图片经过完整检查',async()=>{
  const root=path.resolve('.intermediate/doc-links-test',randomUUID())
  await fs.mkdir(path.join(root,'docs'),{recursive:true})
  try{
    await fs.writeFile(path.join(root,'README.md'),'# 工具\n[说明][guide]\n[guide]: docs/guide.md#重复标题-1\n[空格](docs/a%20b.md#mixed-code-标题)\n![图片](docs/image.svg)\n<a href="docs/guide.md#manual">HTML</a>\n[网站](https://example.com/missing)\n')
    await fs.writeFile(path.join(root,'docs/guide.md'),'# 重复标题\n# 重复标题\n<span id="manual"></span>\n[自身](#重复标题)\n')
    await fs.writeFile(path.join(root,'docs/a b.md'),'# Mixed `code` 标题\n')
    await fs.writeFile(path.join(root,'docs/image.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>')
    assert.deepEqual((await checkDocumentation(root)).failures,[])
    await fs.appendFile(path.join(root,'README.md'),'[失效文件](docs/missing.md)\n[失效锚点](docs/guide.md#missing)\n')
    const result=await checkDocumentation(root)
    assert.equal(result.failures.length,2)
    assert.equal(result.failures[0].reason,'本地文件不存在')
    assert.match(result.failures[1].reason,/锚点不存在/)
  }finally{await fs.rm(root,{recursive:true,force:true})}
})
