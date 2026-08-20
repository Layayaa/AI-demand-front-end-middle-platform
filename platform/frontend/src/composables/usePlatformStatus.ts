import { onMounted, ref } from 'vue'
import { api } from '../api/client'

const healthOk = ref<boolean | null>(null)
const dbOk = ref<boolean | null>(null)
const llmConfigured = ref<boolean | null>(null)
let requested = false

async function refreshStatus() {
  const [health, ready, llm] = await Promise.allSettled([
    api.health(),
    api.ready(),
    api.llmStatus(),
  ])
  healthOk.value = health.status === 'fulfilled' ? health.value.ok : false
  dbOk.value = ready.status === 'fulfilled' ? ready.value.database.ready : false
  llmConfigured.value = llm.status === 'fulfilled' ? llm.value.apiKeyConfigured : false
}

export function usePlatformStatus() {
  onMounted(() => {
    if (requested) return
    requested = true
    void refreshStatus()
  })
  return { healthOk, dbOk, llmConfigured, refreshStatus }
}

export function dotClass(value: boolean | null) {
  if (value === null) return ''
  if (value) return 'ok'
  return 'bad'
}
