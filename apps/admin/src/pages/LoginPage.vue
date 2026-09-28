<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, setAccessToken } from '../api'

type AuthTab = 'login' | 'register'
type AuthState = 'idle' | 'submitting'

const router = useRouter()
const activeTab = ref<AuthTab>('login')
const account = ref('')
const password = ref('')
const name = ref('')
const errorMessage = ref('')
const state = ref<AuthState>('idle')

const canLogin = computed(
  () =>
    state.value === 'idle' &&
    account.value.trim().length > 0 &&
    password.value.length > 0,
)

const canRegister = computed(
  () =>
    state.value === 'idle' &&
    account.value.trim().length > 0 &&
    password.value.length >= 6 &&
    name.value.trim().length > 0,
)

function selectTab(tab: AuthTab): void {
  if (state.value !== 'idle') return
  activeTab.value = tab
  errorMessage.value = ''
}

async function parseJson(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text()
  if (!text) return null
  return JSON.parse(text) as Record<string, unknown>
}

async function handleLogin(): Promise<void> {
  if (!canLogin.value) return
  errorMessage.value = ''
  const submittedPassword = password.value
  password.value = ''
  state.value = 'submitting'
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account: account.value.trim(),
        password: submittedPassword,
      }),
    })
    const data = await parseJson(res)
    if (!res.ok) {
      throw new Error(
        data?.error ? String(data.error) : '账号或密码不正确，请重试。',
      )
    }
    const token = data?.accessToken
    if (typeof token !== 'string' || !token) {
      throw new Error('登录响应缺少 accessToken')
    }
    setAccessToken(token)
    account.value = ''
    await router.push('/workspace')
  } catch (e) {
    state.value = 'idle'
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function handleRegister(): Promise<void> {
  if (!canRegister.value) return
  errorMessage.value = ''
  const submittedPassword = password.value
  password.value = ''
  state.value = 'submitting'
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account: account.value.trim(),
        password: submittedPassword,
        name: name.value.trim(),
      }),
    })
    const data = await parseJson(res)
    if (!res.ok) {
      throw new Error(data?.error ? String(data.error) : '注册失败，请重试。')
    }
    const token = data?.accessToken
    if (typeof token !== 'string' || !token) {
      throw new Error('注册响应缺少 accessToken')
    }
    setAccessToken(token)
    account.value = ''
    name.value = ''
    await router.push('/workspace')
  } catch (e) {
    state.value = 'idle'
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
        <h1 id="login-title">管理后台</h1>
        <p class="login-lede">使用本系统账号登录或注册</p>
      </header>

      <div class="login-tabs" role="tablist" aria-label="身份方式">
        <button
          class="login-tab"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'login'"
          @click="selectTab('login')"
        >
          登录
        </button>
        <button
          class="login-tab"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'register'"
          @click="selectTab('register')"
        >
          注册
        </button>
      </div>

      <div v-show="activeTab === 'login'" class="login-panel" role="tabpanel">
        <form @submit.prevent="handleLogin">
          <div class="login-field">
            <label for="login-account">账号</label>
            <input
              id="login-account"
              v-model="account"
              class="login-control"
              name="account"
              type="text"
              autocomplete="username"
              placeholder="账号"
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
          <button class="login-button" type="submit" :disabled="!canLogin">
            {{ state === 'submitting' ? '登录中…' : '登录' }}
          </button>
        </form>
      </div>

      <div v-show="activeTab === 'register'" class="login-panel" role="tabpanel">
        <form @submit.prevent="handleRegister">
          <div class="login-field">
            <label for="reg-name">姓名</label>
            <input
              id="reg-name"
              v-model="name"
              class="login-control"
              type="text"
              autocomplete="name"
              placeholder="显示名称"
              :disabled="state !== 'idle'"
            />
          </div>
          <div class="login-field">
            <label for="reg-account">账号</label>
            <input
              id="reg-account"
              v-model="account"
              class="login-control"
              type="text"
              autocomplete="username"
              placeholder="账号"
              :disabled="state !== 'idle'"
            />
          </div>
          <div class="login-field">
            <label for="reg-password">密码</label>
            <input
              id="reg-password"
              v-model="password"
              class="login-control"
              type="password"
              autocomplete="new-password"
              placeholder="至少 6 位"
              :disabled="state !== 'idle'"
            />
          </div>
          <button class="login-button" type="submit" :disabled="!canRegister">
            {{ state === 'submitting' ? '注册中…' : '注册并进入' }}
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

label {
  color: #374151;
  font-size: 0.8125rem;
  line-height: 1.25rem;
  font-weight: 600;
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

.login-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.login-error {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: #dc2626;
}
</style>
