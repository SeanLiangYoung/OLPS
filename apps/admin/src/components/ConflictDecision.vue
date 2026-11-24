<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  summary: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  submit: [payload: { userMessage: string }]
}>()

const userMessage = ref('')

const canSubmit = computed(
  () => !props.disabled && userMessage.value.trim().length > 0,
)

function onSubmit(): void {
  if (!canSubmit.value) return
  emit('submit', { userMessage: userMessage.value.trim() })
  userMessage.value = ''
}
</script>

<template>
  <el-card class="conflict-panel" shadow="never" aria-labelledby="conflict-title">
    <h3 id="conflict-title">需要你的决定</h3>
    <el-alert :title="summary" type="warning" show-icon :closable="false" class="conflict-summary" />
    <el-form label-position="top" @submit.prevent="onSubmit">
      <el-form-item label="你的决定或说明">
        <el-input
          v-model="userMessage"
          data-testid="conflict-input"
          type="textarea"
          :rows="4"
          :disabled="disabled"
          placeholder="例如：保留 A 用户的标题，B 用户的段落合并到第二屏"
        />
      </el-form-item>
      <el-form-item>
        <el-button
          type="primary"
          data-testid="conflict-submit"
          :disabled="!canSubmit"
          @click="onSubmit"
        >
          提交并继续同步
        </el-button>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<style scoped>
.conflict-panel {
  margin-top: 1rem;
  border-color: var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
}
.conflict-summary {
  margin-bottom: 0.75rem;
}
</style>
