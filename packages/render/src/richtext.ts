import { generateHTML } from '@tiptap/html'
import type { JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Window } from 'happy-dom'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

function createSanitizeDocument(): Document {
  if (
    typeof globalThis.document !== 'undefined'
    && typeof globalThis.document.implementation?.createHTMLDocument === 'function'
  ) {
    return globalThis.document.implementation.createHTMLDocument('')
  }
  const window = new Window()
  return window.document as unknown as Document
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim()
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return true
  }
  try {
    const url = new URL(trimmed)
    return ALLOWED_PROTOCOLS.has(url.protocol)
  } catch {
    return false
  }
}

const richtextExtensions = [
  StarterKit.configure({
    link: false,
  }),
  Link.configure({
    openOnClick: false,
    autolink: false,
    defaultProtocol: 'https',
    protocols: ['http', 'https', 'mailto', 'tel'],
    isAllowedUri: (url, ctx) => {
      if (!ctx.defaultValidate(url)) {
        return false
      }
      return isSafeHref(url)
    },
    HTMLAttributes: {
      rel: 'noopener noreferrer',
      target: null,
    },
  }),
]

export function sanitizeRichHtml(html: string): string {
  const document = createSanitizeDocument()
  document.body.innerHTML = html

  for (const script of [...document.querySelectorAll('script')]) {
    script.remove()
  }

  for (const node of [...document.querySelectorAll('*')]) {
    const attributeNames = [...node.attributes].map((attribute) => attribute.name)
    for (const attributeName of attributeNames) {
      const name = attributeName.toLowerCase()
      const value = node.getAttribute(attributeName) ?? ''
      if (name.startsWith('on')) {
        node.removeAttribute(attributeName)
        continue
      }
      if ((name === 'href' || name === 'src' || name === 'xlink:href') && !isSafeHref(value)) {
        node.removeAttribute(attributeName)
      }
    }
  }

  return document.body.innerHTML
}

export function renderRichtext(doc: JSONContent): string {
  const html = generateHTML(doc, richtextExtensions)
  return sanitizeRichHtml(html)
}
