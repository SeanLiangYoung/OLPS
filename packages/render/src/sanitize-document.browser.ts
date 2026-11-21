export function createSanitizeDocument():Document{
  return document.implementation.createHTMLDocument('')
}
