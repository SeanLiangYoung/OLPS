import canonicalize from 'canonicalize'

export async function translationSourceHash(localized:Record<string,unknown>):Promise<string>{
  const content={...localized}
  for(const key of ['locale','slug','sourceHash','updatedAt'])delete content[key]
  const json=canonicalize(content)
  if(json===undefined)throw new Error('原文内容无效')
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json))
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('')
}
