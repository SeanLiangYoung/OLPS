import { describe, expect, it } from 'vitest'
import { enqueueSiteWork, resetSiteQueuesForTests } from './import-queue.js'

describe('import-queue', () => {
  it('task 失败时返回的 Promise 仍会 resolve，不向外抛出', async () => {
    resetSiteQueuesForTests()
    await expect(
      enqueueSiteWork('site-fail', async () => {
        throw new Error('boom')
      }),
    ).resolves.toBeUndefined()
  })

  it('前一个 task 失败后仍会执行同站后续 task', async () => {
    resetSiteQueuesForTests()
    const order: string[] = []
    await enqueueSiteWork('site-chain', async () => {
      order.push('a')
      throw new Error('a-failed')
    })
    await enqueueSiteWork('site-chain', async () => {
      order.push('b')
    })
    expect(order).toEqual(['a', 'b'])
  })
})
