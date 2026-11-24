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
  <el-card class="owners-panel" shadow="never">
    <h3>共同所有者</h3>
    <p v-if="loading" class="muted">加载中…</p>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="page-alert" />
    <el-table v-if="users.length" :data="users" style="width:100%">
      <el-table-column label="所有者">
        <template #default="{ row }">{{ row.name }} ({{ row.account }})</template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-button text type="danger" @click="removeOwner(row.userId)">移除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <p v-else-if="!loading" class="muted">暂无其他所有者。</p>
    <div class="row add-row">
      <el-input v-model="newAccount" placeholder="已有用户账号" style="max-width:240px" />
      <el-button type="primary" @click="addOwner">添加所有者</el-button>
    </div>
  </el-card>
</template>

<style scoped>
.owners-panel h3{margin-top:0}
.page-alert{margin:8px 0}
.add-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:0.75rem}
.muted{color:var(--el-text-color-secondary)}
</style>
