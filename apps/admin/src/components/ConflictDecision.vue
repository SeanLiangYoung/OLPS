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
  <section class="conflict-panel" aria-labelledby="conflict-title">
    <h3 id="conflict-title">需要你的决定</h3>
    <p class="conflict-summary">{{ summary }}</p>
    <label class="conflict-field">
      你的决定或说明
      <textarea
        v-model="userMessage"
        data-testid="conflict-input"
        rows="4"
        :disabled="disabled"
        placeholder="例如：保留 A 用户的标题，B 用户的段落合并到第二屏"
      />
    </label>
    <button
      type="button"
      data-testid="conflict-submit"
      :disabled="!canSubmit"
      @click="onSubmit"
    >
      提交并继续同步
    </button>
  </section>
</template>

<style scoped>
.conflict-panel {
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid #e7c9a8;
  border-radius: 12px;
  background: #fff8f0;
}

.conflict-summary {
  margin: 0 0 0.75rem;
  color: #7c2d12;
  font-size: 0.92rem;
}

.conflict-field {
  display: grid;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}
</style>
