import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const fullSiteFixtureRoot = path.resolve(
  here,
  '../../test-fixtures/sites/full-site',
)
