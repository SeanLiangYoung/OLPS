import { claimMailTask, deliverMailTask, recoverInterruptedMail } from './mail-service.js'

export function startMailWorker(): { stop: () => Promise<void> } {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> = Promise.resolve()
  async function tick(): Promise<void> {
    await recoverInterruptedMail()
    if (!process.env.SMTP_HOST?.trim()) return
    const task = await claimMailTask()
    if (task) await deliverMailTask(task)
  }
  function schedule(): void {
    if (stopped) return
    timer = setTimeout(() => {
      running = tick().then(schedule)
    }, 1000)
    timer.unref()
  }
  schedule()
  return { stop: async () => { stopped = true; if (timer) clearTimeout(timer); await running } }
}
