import { expect, it } from 'vitest'
import { assertDraftOrdinaryEditAllowed } from './draft-ordinary-edit-guard.js'

it.each(['syncing', 'archived', 'error'])('编辑拒绝 %s 状态', status => {
  expect(() => assertDraftOrdinaryEditAllowed({ status, init_status: 'ready', sync_status: 'clean' })).toThrow('DRAFT_ORDINARY_EDIT_BLOCKED')
})
it('尚未准备好的网站不能修改内容', () => {
  expect(() => assertDraftOrdinaryEditAllowed({ status: 'active', init_status: 'initializing', sync_status: 'clean' })).toThrow('DRAFT_ORDINARY_EDIT_BLOCKED')
  expect(() => assertDraftOrdinaryEditAllowed({ status: 'active', init_status: 'ready', sync_status: 'validation_failed' })).not.toThrow()
})
