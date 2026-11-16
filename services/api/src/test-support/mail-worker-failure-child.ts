import { startMailWorker } from '../mail-worker.js'

const worker = startMailWorker()
setTimeout(async () => { await worker.stop() }, 2500)
