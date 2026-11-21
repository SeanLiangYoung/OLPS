import type pg from 'pg'
import { migrateCmsSchema } from './cms-schema.js'
import { createContentIndexSchema } from './content-index.js'
import { createCredentialSchema } from './credentials.js'
import { createCmsPreviewSchema } from './cms-preview.js'
import { createCmsPublicSchema } from './cms-public.js'
import { migrateJobEvents } from './jobs/events.js'
import { createCmsResourceSchema } from './cms-source-routes.js'
import { createIntegrationSchema } from './integration-schema.js'
import { createCmsPublicationSchema } from './cms-publication.js'
import { migrateCmsSandboxes } from './cms-migration.js'
import { migrateLegacyInquiries } from './cms-legacy-inquiries.js'
import { createCmsPluginApiSchema } from './cms-plugin-api.js'

export async function migrateCmsRuntime(database: pg.Pool,options:Parameters<typeof migrateCmsSandboxes>[1]={}): Promise<void> {
  const client = await database.connect()
  try {
    await migrateCmsSchema(client)
    await createContentIndexSchema(client)
    await createCredentialSchema(client)
    await createCmsPluginApiSchema(client)
    await createCmsPreviewSchema(client)
    await createCmsPublicSchema(client)
    await migrateJobEvents(client)
    await createCmsResourceSchema(client)
    await createIntegrationSchema(client)
    await createCmsPublicationSchema(client)
  } finally { client.release() }
  await migrateCmsSandboxes(database,options)
  await migrateLegacyInquiries(database)
}
