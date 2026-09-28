import type { ChildProcess } from 'node:child_process'

export function childProcessHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

export function waitForChildProcessExit(child: ChildProcess): Promise<void> {
  if (childProcessHasExited(child)) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    child.once('exit', () => resolve())
  })
}

export async function stopChildProcess(child: ChildProcess, termGraceMs: number): Promise<void> {
  if (childProcessHasExited(child)) {
    return
  }
  child.kill('SIGTERM')
  await Promise.race([
    waitForChildProcessExit(child),
    new Promise<void>((resolve) => {
      setTimeout(resolve, termGraceMs)
    }),
  ])
  if (childProcessHasExited(child)) {
    return
  }
  child.kill('SIGKILL')
  await waitForChildProcessExit(child)
}
