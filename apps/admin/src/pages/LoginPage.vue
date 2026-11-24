<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { setAccessToken } from '../api'
import type { User } from '../types'
import { setCurrentUser } from '../workspaceSession'

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

function canLeaveTab(): boolean {
  return state.value === 'idle'
}

function onTabChange(): void {
  errorMessage.value = ''
}

async function parseJson(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text()
  if (!text) return null
  return JSON.parse(text) as Record<string, unknown>
}

function applyAuthUser(data: Record<string, unknown> | null): void {
  const raw = data?.user
  if (raw && typeof raw === 'object' && 'userId' in raw && 'account' in raw) {
    setCurrentUser(raw as User)
  }
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
    applyAuthUser(data)
    account.value = ''
    await router.push('/sites')
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
    applyAuthUser(data)
    account.value = ''
    name.value = ''
    await router.push('/sites')
  } catch (e) {
    state.value = 'idle'
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <main class="login-page">
    <el-card class="login-card" shadow="always" aria-labelledby="login-title">
      <header class="login-brand">
        <span class="login-mark" aria-hidden="true">O</span>
        <p class="login-product">Open LPS</p>
        <h1 id="login-title">管理后台</h1>
        <p class="login-lede">使用本系统账号登录或注册</p>
      </header>

      <el-tabs
        v-model="activeTab"
        stretch
        :before-leave="canLeaveTab"
        @tab-change="onTabChange"
      >
        <el-tab-pane label="登录" name="login">
          <el-form label-position="top" @submit.prevent="handleLogin">
            <el-form-item label="账号">
              <div data-testid="login-account">
                <el-input
                  v-model="account"
                  name="account"
                  autocomplete="username"
                  placeholder="账号"
                  :disabled="state !== 'idle'"
                />
              </div>
            </el-form-item>
            <el-form-item label="密码">
              <div data-testid="login-password">
                <el-input
                  v-model="password"
                  name="password"
                  type="password"
                  show-password
                  autocomplete="current-password"
                  placeholder="请输入密码"
                  :disabled="state !== 'idle'"
                />
              </div>
            </el-form-item>
            <el-button
              data-testid="login-submit"
              type="primary"
              native-type="submit"
              class="login-submit"
              :disabled="!canLogin"
              :loading="state === 'submitting' && activeTab === 'login'"
            >
              {{ state === 'submitting' && activeTab === 'login' ? '登录中…' : '登录' }}
            </el-button>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="注册" name="register">
          <el-form label-position="top" @submit.prevent="handleRegister">
            <el-form-item label="姓名">
              <el-input
                v-model="name"
                autocomplete="name"
                placeholder="显示名称"
                :disabled="state !== 'idle'"
              />
            </el-form-item>
            <el-form-item label="账号">
              <el-input
                v-model="account"
                autocomplete="username"
                placeholder="账号"
                :disabled="state !== 'idle'"
              />
            </el-form-item>
            <el-form-item label="密码">
              <el-input
                v-model="password"
                type="password"
                show-password
                autocomplete="new-password"
                placeholder="至少 6 位"
                :disabled="state !== 'idle'"
              />
            </el-form-item>
            <el-button
              type="primary"
              native-type="submit"
              class="login-submit"
              :disabled="!canRegister"
              :loading="state === 'submitting' && activeTab === 'register'"
            >
              {{ state === 'submitting' && activeTab === 'register' ? '注册中…' : '注册并进入' }}
            </el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>

      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        show-icon
        :closable="false"
        class="login-error"
      />
    </el-card>
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
      rgb(64 158 255 / 18%),
      transparent 62%
    ),
    #f0f5fb;
}

.login-card {
  width: min(100%, 26rem);
  margin: 0 auto;
  border-radius: 12px;
}

.login-brand {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: 0.35rem;
  margin-bottom: 1.25rem;
}

.login-mark {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  margin-bottom: 0.35rem;
  border-radius: 0.85rem;
  background: linear-gradient(135deg, #409eff, #337ecc);
  color: #fff;
  font-size: 1.125rem;
  font-weight: 700;
  box-shadow: 0 8px 16px rgb(64 158 255 / 28%);
}

.login-product {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}

h1 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 1.5rem;
  line-height: 1.25;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.login-lede {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 0.875rem;
  line-height: 1.45;
}

.login-submit {
  width: 100%;
  margin-top: 0.25rem;
}

.login-error {
  margin-top: 1rem;
}
</style>
