import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { starterThemeRoot } from '@olps/builtin-themes'
import { createDefaultSiteContent } from '@olps/domain'
import { walkTextFiles } from './fs-walk.js'
import { builtinPluginIds, pluginRoot } from './paths.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fullSiteFixtureRoot = path.resolve(
  here,
  '../../render/test-fixtures/sites/full-site',
)

const CONTACT_PAGE_ID = '11111111-1111-4111-8111-111111111103'

function contactBlocks(locale: string) {
  return [
    {
      id: `${CONTACT_PAGE_ID}-${locale}-intro`,
      type: 'core/html',
      props: {
        html:
          locale === 'zh-CN'
            ? '<p>联系我们的团队。</p>'
            : '<p>Get in touch with our team.</p>',
      },
      children: [],
    },
    {
      id: `${CONTACT_PAGE_ID}-${locale}-inquiry`,
      type: 'plugin/inquiry-form/form',
      props: {},
      children: [],
    },
    {
      id: `${CONTACT_PAGE_ID}-${locale}-map`,
      type: 'plugin/google-maps/map',
      props: {},
      children: [],
    },
    {
      id: `${CONTACT_PAGE_ID}-${locale}-whatsapp`,
      type: 'plugin/whatsapp/button',
      props: {},
      children: [],
    },
  ]
}

function patchContactLocale(raw: string, locale: string): string {
  const document = JSON.parse(raw) as {
    blocks: unknown[]
  }
  document.blocks = contactBlocks(locale)
  return `${JSON.stringify(document, null, 2)}\n`
}

export async function buildBuiltinSiteFiles(
  options: {
    disabledPluginIds?: string[]
  } = {},
): Promise<Record<string, string>> {
  const disabled = new Set(options.disabledPluginIds ?? [])
  const files = await walkTextFiles(fullSiteFixtureRoot)

  const themeFiles = await walkTextFiles(starterThemeRoot, 'themes/starter')
  Object.assign(files, themeFiles)

  for (const pluginId of builtinPluginIds) {
    const pluginFiles = await walkTextFiles(
      pluginRoot(pluginId),
      `plugins/${pluginId}`,
    )
    Object.assign(files, pluginFiles)
  }

  files[`source/pages/${CONTACT_PAGE_ID}/en.json`] = patchContactLocale(
    files[`source/pages/${CONTACT_PAGE_ID}/en.json`]!,
    'en',
  )
  files[`source/pages/${CONTACT_PAGE_ID}/zh-CN.json`] = patchContactLocale(
    files[`source/pages/${CONTACT_PAGE_ID}/zh-CN.json`]!,
    'zh-CN',
  )

  const defaults = createDefaultSiteContent({
    siteName: 'Acme Manufacturing',
    siteUrl: 'https://www.example.com',
    company: {
      name: 'Acme Manufacturing Ltd.',
      address: '100 Industry Road',
      phone: '+1-555-0100',
      email: 'sales@example.com',
    },
  })

  const pluginsDocument = {
    schemaVersion: 1,
    plugins: Object.fromEntries(
      builtinPluginIds.map((pluginId) => [
        pluginId,
        {
          enabled: !disabled.has(pluginId),
          permissionsAcceptedAt: null,
          permissionsAcceptedBy: null,
          settings: defaults.plugins.plugins[pluginId]?.settings ?? {},
        },
      ]),
    ),
  }
  files['source/plugins.json'] = `${JSON.stringify(pluginsDocument, null, 2)}\n`

  return files
}
