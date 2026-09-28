export function blankPageCreateError(title: string, slug: string): string | null {
  const t = title.trim()
  const s = slug.trim()
  if (!t || !s) return '请填写标题与 slug'
  return null
}
