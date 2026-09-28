export function slugifyKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
