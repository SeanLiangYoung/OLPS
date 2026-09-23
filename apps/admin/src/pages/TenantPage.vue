<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, setTenantId } from '../api'
import { setStoredSiteId } from '../site'

type TenantDetail = {
  tenantId: string
  name: string
  tenantCode?: string
}

const router = useRouter()
const tenants = ref<TenantDetail[]>([])
const error = ref('')
const loading = ref(true)

onMounted(async () => {
  try {
    const data = await api<{
      tenants: string[]
      tenantDetails?: TenantDetail[]
    }>('GET', '/api/auth/tenants', undefined, {
      skipTenant: true,
    })
    if (data.tenantDetails?.length) {
      tenants.value = data.tenantDetails
    } else {
      tenants.value = (data.tenants ?? []).map((tenantId) => ({
        tenantId,
        name: `租户 ${tenantId}`,
      }))
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

function choose(tenant: TenantDetail) {
  setTenantId(tenant.tenantId)
  setStoredSiteId('')
  router.push('/dashboard')
}
</script>

<template>
  <main class="tenant-page">
    <section class="tenant-card" aria-labelledby="tenant-title">
      <header class="tenant-brand">
        <span class="tenant-mark" aria-hidden="true">O</span>
        <p class="tenant-product">Open LPS</p>
        <h1 id="tenant-title">选择当前租户</h1>
        <p class="tenant-lede">列表来自 AI Sites，之后所有操作都在所选租户下</p>
      </header>

      <p v-if="loading" class="tenant-hint">正在加载租户…</p>
      <p v-else-if="error" class="tenant-error" role="alert">{{ error }}</p>
      <p v-else-if="tenants.length === 0" class="tenant-hint">
        当前账号在 AI Sites 下没有可见租户。
      </p>

      <ul v-else class="tenant-list">
        <li v-for="tenant in tenants" :key="tenant.tenantId">
          <button class="tenant-item" type="button" @click="choose(tenant)">
            <span class="tenant-name">{{ tenant.name }}</span>
            <span class="tenant-meta">
              <span v-if="tenant.tenantCode">{{ tenant.tenantCode }}</span>
              <span>ID {{ tenant.tenantId }}</span>
            </span>
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.tenant-page {
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

.tenant-card {
  display: grid;
  gap: 1.5rem;
  width: min(100%, 28rem);
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

.tenant-brand {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: 0.35rem;
}

.tenant-mark {
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

.tenant-product {
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

.tenant-lede {
  margin: 0;
  color: #6b7280;
  font-size: 0.875rem;
  line-height: 1.45;
}

.tenant-list {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tenant-item {
  display: grid;
  gap: 0.35rem;
  width: 100%;
  min-height: 3.5rem;
  padding: 0.9rem 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.85rem;
  background: #f9fafb;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.tenant-item:hover {
  border-color: #c7d2fe;
  background: #f8faff;
}

.tenant-name {
  color: #111827;
  font-size: 0.9375rem;
  font-weight: 600;
}

.tenant-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  color: #6b7280;
  font-size: 0.75rem;
}

.tenant-hint,
.tenant-error {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.45;
  text-align: center;
}

.tenant-hint {
  color: #4b5563;
}

.tenant-error {
  color: #dc2626;
}

@media (max-width: 480px) {
  .tenant-page {
    align-items: start;
    padding: 1rem;
  }

  .tenant-card {
    margin-top: 8vh;
    padding: 1.5rem 1.25rem 1.25rem;
  }
}
</style>
