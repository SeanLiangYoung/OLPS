<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { UploadFile } from 'element-plus'
import { api } from '../api'

export type BasicInfoQr = {
  mediaId: string
  caption?: string
  path?: string
}

export type BasicInfoSnapshot = {
  siteName: string
  siteUrl: string
  company: { name: string; address: string; phone: string; email: string }
  socialLinks: Array<{ platform: string; url: string }>
  iconMediaId: string | null
  whatsappPhone: string
  mapsAddress: string
  qrMedia: BasicInfoQr[]
}

const props = defineProps<{
  draftId: string
  before: BasicInfoSnapshot
  after: BasicInfoSnapshot
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:after': [value: BasicInfoSnapshot]
}>()

const resourceToken = ref('')
const resourceBaseUrl = ref('')
const uploadBusy = ref('')
const pathByMediaId = ref<Record<string, string>>({})

const afterModel = computed({
  get: () => props.after,
  set: (value) => emit('update:after', value),
})

function patchAfter(patch: Partial<BasicInfoSnapshot>): void {
  emit('update:after', { ...props.after, ...patch })
}

function patchCompany(patch: Partial<BasicInfoSnapshot['company']>): void {
  patchAfter({ company: { ...props.after.company, ...patch } })
}

function mediaUrl(mediaId: string | null | undefined, path?: string): string {
  if (!mediaId || !resourceToken.value || !resourceBaseUrl.value) return ''
  const filePath = path || pathByMediaId.value[mediaId]
  if (!filePath || filePath.endsWith('.json')) return ''
  return `${resourceBaseUrl.value}${filePath.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(resourceToken.value)}`
}

async function refreshResourceAccess(): Promise<void> {
  const access = await api<{ token: string; resourceBaseUrl: string }>(
    'POST',
    `/api/drafts/${encodeURIComponent(props.draftId)}/resource-access`,
  )
  resourceToken.value = access.token
  resourceBaseUrl.value = access.resourceBaseUrl
}

async function resolveMediaPath(mediaId: string): Promise<string | undefined> {
  if (pathByMediaId.value[mediaId]) return pathByMediaId.value[mediaId]
  const entry = await api<{ media: { path: string } }>(
    'GET',
    `/api/drafts/${encodeURIComponent(props.draftId)}/media/${encodeURIComponent(mediaId)}`,
  )
  pathByMediaId.value = { ...pathByMediaId.value, [mediaId]: entry.media.path }
  return entry.media.path
}

async function ensurePreviewPaths(): Promise<void> {
  const ids = new Set<string>()
  if (props.before.iconMediaId) ids.add(props.before.iconMediaId)
  if (props.after.iconMediaId) ids.add(props.after.iconMediaId)
  for (const item of [...props.before.qrMedia, ...props.after.qrMedia]) {
    if (item.path) {
      pathByMediaId.value = { ...pathByMediaId.value, [item.mediaId]: item.path }
    } else {
      ids.add(item.mediaId)
    }
  }
  for (const mediaId of ids) {
    await resolveMediaPath(mediaId).catch(() => undefined)
  }
}

async function uploadIcon(file: UploadFile): Promise<void> {
  const raw = file.raw
  if (!raw || props.disabled) return
  uploadBusy.value = 'icon'
  try {
    const body = new FormData()
    body.append('file', raw)
    const entry = await api<{ media: { mediaId: string; path: string } }>(
      'POST',
      `/api/drafts/${encodeURIComponent(props.draftId)}/media`,
      body,
    )
    pathByMediaId.value = { ...pathByMediaId.value, [entry.media.mediaId]: entry.media.path }
    patchAfter({ iconMediaId: entry.media.mediaId })
    await refreshResourceAccess()
  } finally {
    uploadBusy.value = ''
  }
}

async function uploadQr(file: UploadFile): Promise<void> {
  const raw = file.raw
  if (!raw || props.disabled) return
  uploadBusy.value = 'qr'
  try {
    const body = new FormData()
    body.append('file', raw)
    const entry = await api<{ media: { mediaId: string; path: string } }>(
      'POST',
      `/api/drafts/${encodeURIComponent(props.draftId)}/media`,
      body,
    )
    const path = entry.media.path || (await resolveMediaPath(entry.media.mediaId))
    if (path) pathByMediaId.value = { ...pathByMediaId.value, [entry.media.mediaId]: path }
    patchAfter({
      qrMedia: [
        ...props.after.qrMedia,
        { mediaId: entry.media.mediaId, caption: raw.name, path },
      ],
    })
    await refreshResourceAccess()
  } finally {
    uploadBusy.value = ''
  }
}

function removeQr(index: number): void {
  const next = props.after.qrMedia.slice()
  next.splice(index, 1)
  patchAfter({ qrMedia: next })
}

function addSocialLink(): void {
  patchAfter({
    socialLinks: [...props.after.socialLinks, { platform: '', url: 'https://' }],
  })
}

function removeSocialLink(index: number): void {
  const next = props.after.socialLinks.slice()
  next.splice(index, 1)
  patchAfter({ socialLinks: next })
}

function displayText(value: string | null | undefined): string {
  const text = (value ?? '').trim()
  return text || '（空）'
}

function socialText(links: Array<{ platform: string; url: string }>): string {
  if (!links.length) return '（空）'
  return links.map((link) => `${link.platform || '平台'} · ${link.url || '（空）'}`).join('；')
}

watch(
  () => props.draftId,
  () => {
    void refreshResourceAccess()
      .then(() => ensurePreviewPaths())
      .catch(() => {
        resourceToken.value = ''
        resourceBaseUrl.value = ''
      })
  },
  { immediate: true },
)

watch(
  () => [props.before, props.after],
  () => {
    void ensurePreviewPaths()
  },
  { deep: true },
)

onUnmounted(() => {
  resourceToken.value = ''
  resourceBaseUrl.value = ''
})
</script>

<template>
  <div class="compare" :aria-disabled="disabled ? 'true' : undefined">
    <div class="row">
      <div class="label">网站名称</div>
      <div class="before">{{ displayText(before.siteName) }}</div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="after">
        <el-input :model-value="afterModel.siteName" :disabled="disabled" @update:model-value="patchAfter({ siteName: String($event) })" />
      </div>
    </div>

    <div class="row">
      <div class="label">网站网址</div>
      <div class="before">{{ displayText(before.siteUrl) }}</div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="after">
        <el-input :model-value="afterModel.siteUrl" :disabled="disabled" @update:model-value="patchAfter({ siteUrl: String($event) })" />
      </div>
    </div>

    <div class="row">
      <div class="label">公司名称</div>
      <div class="before">{{ displayText(before.company.name) }}</div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="after">
        <el-input :model-value="afterModel.company.name" :disabled="disabled" @update:model-value="patchCompany({ name: String($event) })" />
      </div>
    </div>

    <div class="row">
      <div class="label">公司地址</div>
      <div class="before">{{ displayText(before.company.address) }}</div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="after">
        <el-input :model-value="afterModel.company.address" :disabled="disabled" @update:model-value="patchCompany({ address: String($event) })" />
      </div>
    </div>

    <div class="row">
      <div class="label">联系电话</div>
      <div class="before">{{ displayText(before.company.phone) }}</div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="after">
        <el-input :model-value="afterModel.company.phone" :disabled="disabled" @update:model-value="patchCompany({ phone: String($event) })" />
      </div>
    </div>

    <div class="row">
      <div class="label">联系邮箱</div>
      <div class="before">{{ displayText(before.company.email) }}</div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="after">
        <el-input :model-value="afterModel.company.email" :disabled="disabled" @update:model-value="patchCompany({ email: String($event) })" />
      </div>
    </div>

    <div class="row">
      <div class="label">WhatsApp</div>
      <div class="before">{{ displayText(before.whatsappPhone) }}</div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="after">
        <el-input :model-value="afterModel.whatsappPhone" :disabled="disabled" @update:model-value="patchAfter({ whatsappPhone: String($event) })" />
      </div>
    </div>

    <div class="row">
      <div class="label">地图地址</div>
      <div class="before">{{ displayText(before.mapsAddress) }}</div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="after">
        <el-input :model-value="afterModel.mapsAddress" :disabled="disabled" @update:model-value="patchAfter({ mapsAddress: String($event) })" />
      </div>
    </div>

    <div class="row row-media">
      <div class="label">网站图标</div>
      <div class="before">
        <img
          v-if="mediaUrl(before.iconMediaId)"
          class="thumb"
          :src="mediaUrl(before.iconMediaId)"
          alt="改动前网站图标"
        >
        <span v-else>{{ before.iconMediaId ? before.iconMediaId : '（空）' }}</span>
      </div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="after">
        <div class="media-row">
          <img
            v-if="mediaUrl(afterModel.iconMediaId)"
            class="thumb"
            :src="mediaUrl(afterModel.iconMediaId)"
            alt="改动后网站图标"
          >
          <el-upload :disabled="disabled || uploadBusy === 'icon'" :show-file-list="false" :auto-upload="false" accept="image/*" @change="uploadIcon">
            <el-button :loading="uploadBusy === 'icon'" :disabled="disabled">上传图标</el-button>
          </el-upload>
          <el-button v-if="afterModel.iconMediaId" :disabled="disabled" @click="patchAfter({ iconMediaId: null })">清除</el-button>
        </div>
      </div>
    </div>

    <div class="row row-media">
      <div class="label">社交链接</div>
      <div class="before">{{ socialText(before.socialLinks) }}</div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="after">
        <div v-for="(link, index) in afterModel.socialLinks" :key="`after-social-${index}`" class="social-row">
          <el-input
            :model-value="link.platform"
            :disabled="disabled"
            placeholder="平台名称"
            @update:model-value="afterModel.socialLinks[index].platform = String($event); patchAfter({ socialLinks: [...afterModel.socialLinks] })"
          />
          <el-input
            :model-value="link.url"
            :disabled="disabled"
            placeholder="平台网址"
            @update:model-value="afterModel.socialLinks[index].url = String($event); patchAfter({ socialLinks: [...afterModel.socialLinks] })"
          />
          <el-button :disabled="disabled" @click="removeSocialLink(index)">删除</el-button>
        </div>
        <el-button :disabled="disabled" @click="addSocialLink">添加社交链接</el-button>
      </div>
    </div>

    <div class="row row-media">
      <div class="label">二维码素材</div>
      <div class="before">
        <div v-if="before.qrMedia.length" class="qr-grid">
          <figure v-for="item in before.qrMedia" :key="`before-qr-${item.mediaId}`">
            <img
              v-if="mediaUrl(item.mediaId, item.path)"
              class="thumb"
              :src="mediaUrl(item.mediaId, item.path)"
              :alt="item.caption || '二维码'"
            >
            <figcaption>{{ item.caption || item.mediaId }}</figcaption>
          </figure>
        </div>
        <span v-else>（空）</span>
      </div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="after">
        <div class="qr-grid">
          <figure v-for="(item, index) in afterModel.qrMedia" :key="`after-qr-${item.mediaId}`">
            <img
              v-if="mediaUrl(item.mediaId, item.path)"
              class="thumb"
              :src="mediaUrl(item.mediaId, item.path)"
              :alt="item.caption || '二维码'"
            >
            <figcaption>{{ item.caption || item.mediaId }}</figcaption>
            <el-button size="small" :disabled="disabled" @click="removeQr(index)">移除</el-button>
          </figure>
        </div>
        <el-upload :disabled="disabled || uploadBusy === 'qr'" :show-file-list="false" :auto-upload="false" accept="image/*" @change="uploadQr">
          <el-button :loading="uploadBusy === 'qr'" :disabled="disabled">上传二维码</el-button>
        </el-upload>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compare {
  display: grid;
  gap: 12px;
  align-content: start;
}
.row {
  display: grid;
  grid-template-columns: 7.5em minmax(0, 1fr) 2em minmax(0, 1.2fr);
  gap: 10px 12px;
  align-items: start;
}
.label {
  color: var(--el-text-color-regular);
  line-height: 32px;
  white-space: nowrap;
}
.label::after {
  content: '：';
}
.before {
  min-width: 0;
  line-height: 32px;
  word-break: break-word;
  color: var(--el-text-color-regular);
}
.arrow {
  text-align: center;
  line-height: 32px;
  color: var(--el-text-color-secondary);
}
.after {
  min-width: 0;
  display: grid;
  gap: 8px;
}
.row-media .before,
.row-media .arrow {
  line-height: 1.5;
  padding-top: 6px;
}
.media-row,
.social-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  width: 100%;
}
.social-row > .el-input {
  flex: 1 1 140px;
}
.thumb {
  max-width: 72px;
  max-height: 72px;
  object-fit: contain;
  border: 1px solid var(--el-border-color);
  background: #fff;
}
.qr-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.qr-grid figure {
  margin: 0;
  display: grid;
  gap: 6px;
  justify-items: start;
}
@media (max-width: 960px) {
  .row {
    grid-template-columns: 6.5em minmax(0, 1fr);
  }
  .arrow {
    display: none;
  }
  .after {
    grid-column: 2;
  }
}
</style>
