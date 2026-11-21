import fs from 'node:fs/promises'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { randomUUID } from 'node:crypto'
import mime from 'mime'
import type { RemoteServiceConfig } from './types.js'
import {
  assertSafeGitCommitId,
  assertSafePublicRelativePath,
  assertValidRemoteSiteId,
} from './validation.js'
import {
  bareRepoDir,
  buildPublicUrl,
  createSiteRecord,
  loadSiteRecord,
  loadPublishedReleaseRecord,
  publishedBundlePath,
  releasePublicDir,
  releaseServerConfigDir,
  savePublishedBundleBytes,
  saveSiteRecord,
  savePublishedReleaseRecord,
} from './site-store.js'
import { extractCommitToDir, fetchBundleToCandidateRef, promoteCommitToMain } from './git-store.js'
import { deployCommitFromWorkTree } from './deploy.js'
import { withSiteLock } from './site-lock.js'
import { resolvePublishedPublicFile } from './public-static.js'
import { listPublishedArtifacts, readPublishedArtifact, readPublishedRedirects, zipPublishedArtifacts } from './artifacts.js'

function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice('Bearer '.length).trim()
}

export function createRemoteApp(config: RemoteServiceConfig): Hono {
  const app = new Hono()

  async function publishedRelease(c: Context) {
    if (extractToken(c.req.header('Authorization')) !== config.serviceToken) return c.json({ error: 'unauthorized' }, 401)
    const remoteSiteId = c.req.param('remoteSiteId')!
    try { assertValidRemoteSiteId(remoteSiteId) }
    catch { return c.json({ error: 'not found' }, 404) }
    let record = await loadSiteRecord(config.dataRoot, remoteSiteId)
    if (!record?.publishedCommitId || !record.deploymentId) return c.json({ error: 'not published' }, 404)
    const requestedCommit = c.req.query('commitId')
    if (requestedCommit) {
      try { assertSafeGitCommitId(requestedCommit) }
      catch { return c.json({ error: 'invalid commit id' }, 400) }
      if (requestedCommit !== record.publishedCommitId) {
        record = await loadPublishedReleaseRecord(config.dataRoot, remoteSiteId, requestedCommit)
        if (!record?.deploymentId) return c.json({ error: 'not published' }, 404)
      }
    }
    return { record, location: { dataRoot: config.dataRoot, remoteSiteId, deploymentId: record.deploymentId } }
  }

  app.get('/api/remote/sites/:remoteSiteId/artifacts', async c => {
    const published = await publishedRelease(c)
    if (published instanceof Response) return published
    return c.json({ publishedCommitId: published.record.publishedCommitId, deploymentId: published.record.deploymentId, files: await listPublishedArtifacts(published.location) })
  })

  app.get('/api/remote/sites/:remoteSiteId/download.zip', async c => {
    const published = await publishedRelease(c)
    if (published instanceof Response) return published
    const bytes = await zipPublishedArtifacts(published.location)
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${published.record.publishedCommitId}.zip"` } })
  })

  app.get('/api/remote/sites/:remoteSiteId/files/*', async c => {
    const published = await publishedRelease(c)
    if (published instanceof Response) return published
    let relative: string
    try {
      relative = decodeURIComponent(c.req.path.slice(`/api/remote/sites/${published.location.remoteSiteId}/files/`.length))
      assertSafePublicRelativePath(relative)
    } catch { return c.json({ error: 'not found' }, 404) }
    const bytes = await readPublishedArtifact(published.location, relative)
    if (!bytes) return c.json({ error: 'not found' }, 404)
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': mime.getType(relative) ?? 'application/octet-stream' } })
  })

  app.post('/api/remote/sites', async (c) => {
    const token = extractToken(c.req.header('Authorization'))
    if (token !== config.serviceToken) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const record = await createSiteRecord(config.dataRoot, config.publicBaseUrl)
    return c.json({ remoteSiteId: record.remoteSiteId, publicUrl: record.publicUrl })
  })

  app.get('/api/remote/sites/:remoteSiteId', async (c) => {
    const token = extractToken(c.req.header('Authorization'))
    if (token !== config.serviceToken) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const remoteSiteId = c.req.param('remoteSiteId')
    try {
      assertValidRemoteSiteId(remoteSiteId)
    } catch {
      return c.json({ error: 'not found' }, 404)
    }
    const record = await loadSiteRecord(config.dataRoot, remoteSiteId)
    if (!record) {
      return c.json({ error: 'not found' }, 404)
    }
    return c.json({
      remoteSiteId: record.remoteSiteId,
      publishedCommitId: record.publishedCommitId,
      publicUrl: record.publicUrl,
      deploymentId: record.deploymentId,
    })
  })

  app.get('/api/remote/sites/:remoteSiteId/bundle', async (c) => {
    const token = extractToken(c.req.header('Authorization'))
    if (token !== config.serviceToken) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const remoteSiteId = c.req.param('remoteSiteId')
    try {
      assertValidRemoteSiteId(remoteSiteId)
    } catch {
      return c.json({ error: 'not found' }, 404)
    }
    const record = await loadSiteRecord(config.dataRoot, remoteSiteId)
    if (!record?.publishedCommitId) {
      return c.json({ error: 'not published' }, 404)
    }
    const stored = publishedBundlePath(
      config.dataRoot,
      remoteSiteId,
      record.publishedCommitId,
    )
    try {
      const bytes = await fs.readFile(stored)
      return new Response(bytes, {
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ error: 'bundle not found for published commit' }, 404)
      }
      throw err
    }
  })

  app.post('/api/remote/sites/:remoteSiteId/push', async (c) => {
    const token = extractToken(c.req.header('Authorization'))
    if (token !== config.serviceToken) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const remoteSiteId = c.req.param('remoteSiteId')
    try {
      assertValidRemoteSiteId(remoteSiteId)
    } catch {
      return c.json({ error: 'not found' }, 404)
    }
    const commitId = c.req.header('X-Commit-Id') ?? ''
    const expectedHeader = c.req.header('X-Expected-Published-Commit-Id') ?? ''
    const expectedPublishedCommitId = expectedHeader.length > 0 ? expectedHeader : null
    try {
      assertSafeGitCommitId(commitId)
    } catch {
      return c.json({ error: 'invalid commit id' }, 400)
    }

    const bundleBytes = Buffer.from(await c.req.arrayBuffer())
    const bundlePath = path.join(config.dataRoot, 'tmp', `push-${randomUUID()}.bundle`)
    await fs.mkdir(path.dirname(bundlePath), { recursive: true })
    await fs.writeFile(bundlePath, bundleBytes)

    return await withSiteLock(remoteSiteId, async () => {
      const record = await loadSiteRecord(config.dataRoot, remoteSiteId)
      if (!record) {
        await fs.rm(bundlePath, { force: true })
        return c.json({ error: 'not found' }, 404)
      }
      const currentPublished = record.publishedCommitId
      if (currentPublished !== null && expectedPublishedCommitId === null) {
        await fs.rm(bundlePath, { force: true })
        return c.json({ error: 'published commit mismatch' }, 409)
      }
      if (expectedPublishedCommitId !== null && expectedPublishedCommitId !== currentPublished) {
        await fs.rm(bundlePath, { force: true })
        return c.json({ error: 'published commit mismatch' }, 409)
      }

      let candidateRef = ''
      try {
        candidateRef = await fetchBundleToCandidateRef(
          bareRepoDir(config.dataRoot, remoteSiteId),
          bundlePath,
          commitId,
        )
      } catch (importErr) {
        await fs.rm(bundlePath, { force: true })
        const detail = importErr instanceof Error ? importErr.message : String(importErr)
        return c.json({ error: 'invalid git bundle', detail }, 400)
      }

      const workDir = path.join(config.dataRoot, 'work', remoteSiteId, randomUUID())
      const deploymentId = randomUUID()
      try {
        await extractCommitToDir(bareRepoDir(config.dataRoot, remoteSiteId), commitId, workDir)
        const deployed = await deployCommitFromWorkTree({
          dataRoot: config.dataRoot,
          remoteSiteId,
          workDir,
          deploymentId,
        })
        if (!deployed.ok) {
          await fs.rm(bundlePath, { force: true })
          return c.json({ error: 'deploy failed', log: deployed.log }, 400)
        }
        await promoteCommitToMain(bareRepoDir(config.dataRoot, remoteSiteId), commitId)
        await savePublishedBundleBytes(config.dataRoot, remoteSiteId, commitId, bundleBytes)
        record.publishedCommitId = commitId
        record.deploymentId = deploymentId
        record.publicUrl = buildPublicUrl(config.publicBaseUrl, remoteSiteId)
        await saveSiteRecord(config.dataRoot, record)
        await savePublishedReleaseRecord(config.dataRoot, record)
        void candidateRef
        return c.json({
          publishedCommitId: commitId,
          deploymentId,
          publicUrl: record.publicUrl,
        })
      } finally {
        await fs.rm(workDir, { recursive: true, force: true })
        await fs.rm(bundlePath, { force: true })
      }
    })
  })

  app.get('/s/:remoteSiteId/*', async (c) => {
    const remoteSiteId = c.req.param('remoteSiteId')
    try {
      assertValidRemoteSiteId(remoteSiteId)
    } catch {
      return c.body(null, 404)
    }
    const record = await loadSiteRecord(config.dataRoot, remoteSiteId)
    if (!record?.publishedCommitId || !record.deploymentId) {
      return c.body(null, 404)
    }
    const rest = c.req.path.replace(`/s/${remoteSiteId}`, '').replace(/^\//, '')
    const relative = rest.length > 0 ? rest : 'index.html'
    try {
      assertSafePublicRelativePath(relative)
    } catch {
      return c.body(null, 404)
    }
    const liveRoot = path.resolve(
      releasePublicDir(config.dataRoot, remoteSiteId, record.deploymentId),
    )
    const redirects = await readPublishedRedirects(releaseServerConfigDir(config.dataRoot, remoteSiteId, record.deploymentId))
    const requestPath = `/${rest}`
    const redirect = redirects.find(rule => rule.status === 301 && rule.from === requestPath)
    if (redirect) {
      const query = new URL(c.req.url).search
      return c.redirect(`/s/${remoteSiteId}${redirect.to}${redirect.to.includes('?') ? '' : query}`, 301)
    }
    const resolved = await resolvePublishedPublicFile(liveRoot, relative)
    if (!resolved) {
      const notFound = await resolvePublishedPublicFile(liveRoot, '404.html')
      if (!notFound) return c.body(null, 404)
      return c.body(await fs.readFile(notFound), 404, { 'Content-Type': 'text/html; charset=UTF-8' })
    }
    const content = await fs.readFile(resolved)
    const servedRelative = path.relative(liveRoot, resolved).replace(/\\/g, '/')
    const contentType = mime.getType(servedRelative) ?? 'application/octet-stream'
    return c.body(content, 200, { 'Content-Type': contentType })
  })

  app.get('/s/:remoteSiteId', async (c) => {
    return c.redirect(`/s/${c.req.param('remoteSiteId')}/index.html`, 302)
  })

  return app
}
