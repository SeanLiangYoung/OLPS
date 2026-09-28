import fs from 'node:fs/promises'
import path from 'node:path'
import { defaultSiteSettings, type SiteSettings } from '@olps/domain'
import { assertSafePathChain } from './path-guard.js'
import {
  PAGES_SUBDIR,
  PUBLISH_CONFIG_FILE,
  SITE_SETTINGS_FILE,
} from './paths.js'
import type { LoadedWorkspace, PublishConfig, StoredPageJson } from './types.js'

async function readJsonFile<T>(absPath: string): Promise<T> {
  const raw = await fs.readFile(absPath, 'utf8')
  return JSON.parse(raw) as T
}

export async function loadWorkspace(workspacePath: string): Promise<LoadedWorkspace> {
  const settingsPath = await assertSafePathChain(workspacePath, SITE_SETTINGS_FILE)
  const settingsRaw = await readJsonFile<Partial<SiteSettings>>(settingsPath)
  const settings: SiteSettings = { ...defaultSiteSettings(), ...settingsRaw }

  let publishConfig: PublishConfig = {}
  try {
    const publishPath = await assertSafePathChain(workspacePath, PUBLISH_CONFIG_FILE)
    publishConfig = await readJsonFile<PublishConfig>(publishPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw err
    }
  }

  const pagesDir = await assertSafePathChain(workspacePath, PAGES_SUBDIR)
  let names: string[] = []
  try {
    names = await fs.readdir(pagesDir)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw err
    }
  }

  const pages: StoredPageJson[] = []
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const rel = path.posix.join(PAGES_SUBDIR.replace(/\\/g, '/'), name)
    const pagePath = await assertSafePathChain(workspacePath, rel)
    const page = await readJsonFile<StoredPageJson>(pagePath)
    pages.push(page)
  }

  return { settings, publishConfig, pages }
}
