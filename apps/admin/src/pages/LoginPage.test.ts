import { mount } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import { describe, expect, it } from 'vitest'
import LoginPage from './LoginPage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/workspace', component: { template: '<div />' } },
  ],
})

describe('LoginPage', () => {
  it('账号密码未填时登录按钮不可用', async () => {
    const wrapper = mount(LoginPage, {
      global: {
        plugins: [router],
      },
    })
    const loginBtn = wrapper.find('[data-testid="login-submit"]')
    expect(loginBtn.attributes('disabled')).toBeDefined()
  })

  it('填写账号密码后登录按钮可用', async () => {
    const wrapper = mount(LoginPage, {
      global: {
        plugins: [router],
      },
    })
    await wrapper.find('[data-testid="login-account"]').setValue('alice')
    await wrapper.find('[data-testid="login-password"]').setValue('secret1')
    const loginBtn = wrapper.find('[data-testid="login-submit"]')
    expect(loginBtn.attributes('disabled')).toBeUndefined()
  })
})
