import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根目录（services/knowledge/src → ../../..） */
export const knowledgeRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
