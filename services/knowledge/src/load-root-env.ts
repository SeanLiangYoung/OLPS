import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { knowledgeRepoRoot } from './repo-root.js'

loadEnv({ path: path.join(knowledgeRepoRoot, '.env') })
