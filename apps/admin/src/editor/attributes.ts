const allowed = new Set(['title', 'lang', 'dir', 'role', 'tabindex', 'aria-label', 'aria-description', 'aria-hidden', 'aria-live'])

export function validatedAttribute(name: string, value: string): Record<string, string> {
  if (!allowed.has(name)) throw new Error('请选择允许编辑的 HTML 属性')
  if (name === 'tabindex' && !['', '-1', '0'].includes(value)) throw new Error('tabindex 仅支持 -1 或 0')
  if (name === 'dir' && !['', 'ltr', 'rtl', 'auto'].includes(value)) throw new Error('dir 仅支持 ltr、rtl 或 auto')
  if (name === 'aria-hidden' && !['', 'true', 'false'].includes(value)) throw new Error('aria-hidden 仅支持 true 或 false')
  return { [name]: value }
}
