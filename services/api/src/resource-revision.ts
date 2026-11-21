import { createHash } from 'node:crypto'

export function resourceRevision(bytes:Buffer|string):string{return `sha256:${createHash('sha256').update(bytes).digest('hex')}`}
