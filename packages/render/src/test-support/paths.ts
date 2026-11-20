import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const fullSiteFixtureRoot = path.resolve(
  here,
  '../../test-fixtures/sites/full-site',
)

export const renderBlocksFixtureRoot = path.resolve(
  here,
  '../../test-fixtures/sites/render-blocks',
)

export const minimalThemeFixtureRoot = path.resolve(
  here,
  '../../test-fixtures/themes/minimal',
)
