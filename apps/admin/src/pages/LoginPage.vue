<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { setToken } from '../api'

type LoginTab = 'password' | 'phone'
type LoginState =
  | 'idle'
  | 'submitting_password'
  | 'sending_code'
  | 'awaiting_code'
  | 'verifying'

const router = useRouter()
const activeTab = ref<LoginTab>('password')
const account = ref('')
const password = ref('')
const phone = ref('')
const code = ref('')
const errorMessage = ref('')
const state = ref<LoginState>('idle')

const canLoginWithPassword = computed(
  () =>
    state.value === 'idle' &&
    account.value.trim().length > 0 &&
    password.value.length > 0,
)
const canSend = computed(
  () => state.value === 'idle' && phone.value.trim().length > 0,
)
const canVerify = computed(
  () => state.value === 'awaiting_code' && code.value.trim().length > 0,
)

function selectTab(tab: LoginTab): void {
  if (state.value !== 'idle' && state.value !== 'awaiting_code') return
  activeTab.value = tab
}

async function parseJson(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${res.status}`)
  }
}

async function handlePasswordLogin(): Promise<void> {
  if (!canLoginWithPassword.value) return
  errorMessage.value = ''
  const submittedPassword = password.value
  password.value = ''
  state.value = 'submitting_password'
  try {
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account: account.value.trim(),
        password: submittedPassword,
      }),
    })
    const data = await parseJson(res)
    if (!res.ok) throw new Error(data?.error || '账号或密码不正确，请重试。')
    if (!data?.accessToken) throw new Error('登录响应缺少 accessToken')
    setToken(data.accessToken)
    account.value = ''
    await router.push('/tenants')
  } catch (e) {
    state.value = 'idle'
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function handleSend(): Promise<void> {
  if (!canSend.value) return
  errorMessage.value = ''
  state.value = 'sending_code'
  try {
    const res = await fetch('/api/auth/phone/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: phone.value.trim() }),
    })
    const data = await parseJson(res)
    if (!res.ok) throw new Error(data?.error || '验证码发送失败，请稍后重试。')
    state.value = 'awaiting_code'
  } catch (e) {
    state.value = 'idle'
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function handleVerify(): Promise<void> {
  if (!canVerify.value) return
  errorMessage.value = ''
  const submittedCode = code.value
  code.value = ''
  state.value = 'verifying'
  try {
    const res = await fetch('/api/auth/phone/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phone: phone.value.trim(),
        code: submittedCode,
      }),
    })
    const data = await parseJson(res)
    if (!res.ok) throw new Error(data?.error || '验证码无效或已过期，请重试。')
    if (!data?.accessToken) throw new Error('登录响应缺少 accessToken')
    setToken(data.accessToken)
    phone.value = ''
    await router.push('/tenants')
  } catch (e) {
    state.value = 'awaiting_code'
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-card" aria-labelledby="login-title">
      <header class="login-brand">
        <span class="login-mark" aria-hidden="true">O</span>
        <p class="login-product">Open LPS</p>
        <h1 id="login-title">登录 Admin</h1>
        <p class="login-lede">使用丝路赞账号进入管理后台</p>
      </header>

      <div class="login-tabs" role="tablist" aria-label="登录方式">
        <button
          class="login-tab"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'password'"
          @click="selectTab('password')"
        >
          账号密码
        </button>
        <button
          class="login-tab"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'phone'"
          @click="selectTab('phone')"
        >
          手机验证码
        </button>
      </div>

      <div v-show="activeTab === 'password'" class="login-panel" role="tabpanel">
        <form @submit.prevent="handlePasswordLogin">
          <div class="login-field">
            <label for="login-account">账号</label>
            <input
              id="login-account"
              v-model="account"
              class="login-control"
              name="account"
              type="text"
              autocomplete="username"
              placeholder="邮箱、用户名或手机号"
              :disabled="state !== 'idle'"
            />
          </div>
          <div class="login-field">
            <label for="login-password">密码</label>
            <input
              id="login-password"
              v-model="password"
              class="login-control"
              name="password"
              type="password"
              autocomplete="current-password"
              placeholder="请输入密码"
              :disabled="state !== 'idle'"
            />
          </div>
          <button
            class="login-button"
            type="submit"
            :disabled="!canLoginWithPassword"
          >
            {{ state === 'submitting_password' ? '登录中…' : '登录' }}
          </button>
        </form>
      </div>

      <div v-show="activeTab === 'phone'" class="login-panel" role="tabpanel">
        <form class="login-phone-form" @submit.prevent="handleSend">
          <div class="login-field">
            <label for="login-phone">手机号</label>
            <div class="login-inline">
              <input
                id="login-phone"
                v-model="phone"
                class="login-control"
                name="phone"
                type="tel"
                autocomplete="tel"
                placeholder="11 位手机号"
                :disabled="state !== 'idle'"
              />
              <button
                class="login-button login-button--secondary"
                type="submit"
                :disabled="!canSend"
              >
                {{ state === 'sending_code' ? '发送中…' : '获取验证码' }}
              </button>
            </div>
          </div>
        </form>

        <p
          v-if="state === 'awaiting_code' || state === 'verifying'"
          class="login-hint"
        >
          验证码已发送，请输入验证码继续。
        </p>

        <form @submit.prevent="handleVerify">
          <div class="login-field">
            <label for="login-code">验证码</label>
            <input
              id="login-code"
              v-model="code"
              class="login-control"
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              placeholder="6 位验证码"
              :disabled="state !== 'awaiting_code'"
            />
          </div>
          <button class="login-button" type="submit" :disabled="!canVerify">
            {{ state === 'verifying' ? '验证中…' : '登录' }}
          </button>
        </form>
      </div>

      <p v-if="errorMessage" class="login-error" role="alert">
        {{ errorMessage }}
      </p>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  place-items: center;
  padding: 2rem 1rem;
  background:
    radial-gradient(
      42rem 22rem at 50% -8%,
      rgb(79 70 229 / 16%),
      transparent 62%
    ),
    #f4f6fb;
}

.login-card {
  display: grid;
  gap: 1.5rem;
  width: min(100%, 26rem);
  margin: 0 auto;
  padding: 2rem 1.75rem 1.75rem;
  border: 1px solid rgb(15 23 42 / 6%);
  border-radius: 1.25rem;
  background: #fff;
  color: #111827;
  box-shadow:
    0 1px 2px rgb(15 23 42 / 4%),
    0 18px 40px rgb(49 85 237 / 8%);
}

.login-brand {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: 0.35rem;
}

.login-mark {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  margin-bottom: 0.35rem;
  border-radius: 0.85rem;
  background: linear-gradient(135deg, #3155ed, #5d38e8);
  color: #fff;
  font-size: 1.125rem;
  font-weight: 700;
  box-shadow: 0 8px 16px rgb(49 85 237 / 22%);
}

.login-product {
  margin: 0;
  color: #4b5563;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}

h1 {
  margin: 0;
  color: #111827;
  font-size: 1.5rem;
  line-height: 1.25;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.login-lede {
  margin: 0;
  color: #6b7280;
  font-size: 0.875rem;
  line-height: 1.45;
}

.login-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 0.25rem;
  border-radius: 0.85rem;
  background: #f3f4f6;
}

.login-tab {
  min-height: 2.25rem;
  padding: 0 0.75rem;
  border: 0;
  border-radius: 0.65rem;
  background: transparent;
  color: #6b7280;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}

.login-tab[aria-selected='true'] {
  background: #fff;
  color: #1f2937;
  box-shadow: 0 1px 2px rgb(15 23 42 / 8%);
}

.login-panel,
form,
.login-field {
  display: grid;
  gap: 0.75rem;
}

.login-field {
  gap: 0.4rem;
}

.login-phone-form {
  gap: 0;
}

label {
  color: #374151;
  font-size: 0.8125rem;
  line-height: 1.25rem;
  font-weight: 600;
}

.login-inline {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
}

.login-control,
.login-button {
  min-height: 2.75rem;
  padding: 0 0.875rem;
  font: inherit;
}

.login-control {
  width: 100%;
  appearance: none;
  border: 1px solid #e5e7eb;
  border-radius: 0.75rem;
  background: #f9fafb;
  color: #111827;
  outline: none;
}

.login-control::placeholder {
  color: #9ca3af;
}

.login-control:focus {
  border-color: #4f46e5;
  background: #fff;
  box-shadow: 0 0 0 3px rgb(79 70 229 / 16%);
}

.login-control:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.login-button {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 0.75rem;
  background: linear-gradient(180deg, #4f6ff3, #4f46e5);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.login-button:hover:not(:disabled) {
  background: linear-gradient(180deg, #4463ea, #4338ca);
}

.login-button--secondary {
  width: auto;
  padding-inline: 0.9rem;
  background: #fff;
  border-color: #e5e7eb;
  color: #374151;
  font-size: 0.8125rem;
  white-space: nowrap;
}

.login-button--secondary:hover:not(:disabled) {
  background: #f8faff;
  border-color: #c7d2fe;
  color: #4338ca;
}

.login-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.login-hint,
.login-error {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.login-hint {
  color: #4f46e5;
}

.login-error {
  color: #dc2626;
}

@media (max-width: 480px) {
  .login-page {
    align-items: start;
    padding: 1rem;
  }

  .login-card {
    margin-top: 8vh;
    padding: 1.5rem 1.25rem 1.25rem;
  }

  .login-inline {
    grid-template-columns: 1fr;
  }
}
</style>
