<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api } from '../api'
import type { User } from '../types'

const props = defineProps<{
  scope: 'site' | 'draft'
  resourceId: string
}>()

const users = ref<User[]>([])
const newAccount = ref('')
const error = ref('')
const message = ref('')
const loading = ref(true)

const ownersPath = () =>
  props.scope === 'site'
    ? `/api/sites/${props.resourceId}/owners`
    : `/api/drafts/${props.resourceId}/owners`

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ users: User[] }>('GET', ownersPath())
    users.value = data.users ?? []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

watch(
  () => [props.scope, props.resourceId],
  () => {
    load()
  },
)

async function addOwner() {
  error.value = ''
  message.value = ''
  const account = newAccount.value.trim()
  if (!account) {
    error.value = '请填写要添加的账号'
    return
  }
  try {
    await api('POST', ownersPath(), { account })
    newAccount.value = ''
    message.value = '已添加所有者'
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function removeOwner(userId: string) {
  error.value = ''
  message.value = ''
  try {
    await api('DELETE', `${ownersPath()}/${userId}`)
    message.value = '已移除所有者'
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <section class="panel" style="background: #fff;">
    <h3 style="margin-top: 0;">共同所有者</h3>
    <p v-if="loading" class="muted">加载中…</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>
    <ul v-if="users.length">
      <li v-for="u in users" :key="u.userId" class="row" style="justify-content: space-between;">
        <span>{{ u.name }} ({{ u.account }})</span>
        <button type="button" class="ghost" @click="removeOwner(u.userId)">移除</button>
      </li>
    </ul>
    <p v-else-if="!loading" class="muted">暂无其他所有者。</p>
    <div class="row" style="margin-top: 0.75rem;">
      <input v-model="newAccount" placeholder="已有用户账号" style="max-width: 240px;" />
      <button type="button" class="secondary" @click="addOwner">添加所有者</button>
    </div>
  </section>
</template>
