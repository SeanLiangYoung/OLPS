import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const serialize:(input:unknown)=>string|undefined=createRequire(import.meta.url)('canonicalize')

export function canonicalJson(value:unknown):string{
  const bytes=serialize(value)
  if(bytes===undefined)throw new Error('内容不是有效JSON')
  return bytes
}

export function sourceHashFor(localized:Record<string,unknown>):string{
  const content={...localized}
  for(const key of ['locale','slug','sourceHash','updatedAt'])delete content[key]
  const bytes=canonicalJson(content)
  return createHash('sha256').update(bytes).digest('hex')
}
