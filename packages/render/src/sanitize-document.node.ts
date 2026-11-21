import { Window } from 'happy-dom'

export function createSanitizeDocument():Document{
  if(typeof globalThis.document!=='undefined'&&typeof globalThis.document.implementation?.createHTMLDocument==='function')return globalThis.document.implementation.createHTMLDocument('')
  return new Window().document as unknown as Document
}
