import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConflictDecision from './ConflictDecision.vue'

describe('ConflictDecision', () => {
  it('未填写决定时提交按钮不可用', () => {
    const wrapper = mount(ConflictDecision, {
      props: {
        summary: '首页标题保留哪一个？',
        disabled: false,
      },
    })
    const btn = wrapper.find('[data-testid="conflict-submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('填写决定并提交时发出 submit 事件', async () => {
    const wrapper = mount(ConflictDecision, {
      props: {
        summary: '首页标题保留哪一个？',
        disabled: false,
      },
      attachTo: document.body,
    })
    const input = wrapper.find('[data-testid="conflict-input"] textarea')
    await input.setValue('保留运营修改的标题')
    await wrapper.find('[data-testid="conflict-submit"]').trigger('click')
    expect(wrapper.emitted('submit')).toBeTruthy()
    expect(wrapper.emitted('submit')![0]).toEqual([
      { userMessage: '保留运营修改的标题' },
    ])
    wrapper.unmount()
  })
})
