export function slugifyKeyword(keyword: string): string {
  const result = keyword
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
  if (!result) throw new Error('关键词需要包含文字或数字')
  return result
}
