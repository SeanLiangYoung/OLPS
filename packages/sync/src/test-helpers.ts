import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = path.dirname(fileURLToPath(import.meta.url))

export function fixtureScript(name: string): string {
  return path.join(packageDir, '..', 'test-fixtures', name)
}

export function siteManifestWithVerify(): string {
  const verify = fixtureScript('verify-site-consistency.mjs')
  const build = fixtureScript('build-public-from-source.mjs')
  return JSON.stringify(
    {
      version: 1,
      verifyCommand: [process.execPath, verify],
      buildCommand: [process.execPath, build],
    },
    null,
    2,
  )
}

export async function sandboxRoot(label: string): Promise<string> {
  const root = path.resolve(process.cwd(), '.intermediate', `sync-${label}-${Date.now().toString(36)}`)
  await fs.mkdir(root, { recursive: true })
  return root
}

export const COLLAB_SETTINGS_BASE =
  '{"defaultLocale":"en","locales":["en"],"brandColor":"blue","supportEmail":"a@example.com"}'

export function settingsWithBrandColor(color: string): string {
  const obj = JSON.parse(COLLAB_SETTINGS_BASE) as Record<string, string>
  obj.brandColor = color
  return JSON.stringify(obj)
}

export function settingsWithSupportEmail(email: string): string {
  const obj = JSON.parse(COLLAB_SETTINGS_BASE) as Record<string, string>
  obj.supportEmail = email
  return JSON.stringify(obj)
}

export function publicHtmlFromSettings(settingsJson: string): string {
  const settings = JSON.parse(settingsJson) as { defaultLocale: string; brandColor?: string; supportEmail?: string }
  return `<!DOCTYPE html><html><head><title>Locale:${settings.defaultLocale}</title></head><body data-brand="${settings.brandColor ?? ''}" data-email="${settings.supportEmail ?? ''}"></body></html>`
}
