import fs from 'node:fs/promises'
import path from 'node:path'
import { defaultSiteSettings, type SiteSettings } from '@olps/domain'
import {
  PAGES_SUBDIR,
  PUBLISH_CONFIG_FILE,
  SITE_SETTINGS_FILE,
  resolveInsideWorkspace,
} from './paths.js'
import type { LoadedWorkspace, PublishConfig, StoredPageJson } from './types.js'

async function readJsonFile<T>(absPath: string): Promise<T> {
  const raw = await fs.readFile(absPath, 'utf8')
  return JSON.parse(raw) as T
}

export async function loadWorkspace(workspacePath: string): Promise<LoadedWorkspace> {
  const settingsPath = resolveInsideWorkspace(workspacePath, SITE_SETTINGS_FILE)
  const settingsRaw = await readJsonFile<Partial<SiteSettings>>(settingsPath)
  const settings: SiteSettings = { ...defaultSiteSettings(), ...settingsRaw }

  let publishConfig: PublishConfig = {}
  const publishPath = resolveInsideWorkspace(workspacePath, PUBLISH_CONFIG_FILE)
  try {
    publishConfig = await readJsonFile<PublishConfig>(publishPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw err
    }
  }

  const pagesDir = resolveInsideWorkspace(workspacePath, PAGES_SUBDIR)
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
    const page = await readJsonFile<StoredPageJson>(path.join(pagesDir, name))
    pages.push(page)
  }

  return { settings, publishConfig, pages }
}
