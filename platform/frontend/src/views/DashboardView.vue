<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { ApiError, api } from '../api/client'
import type { HealthResponse, LlmStatus, ProjectSummary, RagflowStatus, ReadyResponse } from '../api/types'
import StatusStone from '../components/StatusStone.vue'
import UiCard from '../components/UiCard.vue'

const router = useRouter()
const loading = ref(true)
const health = ref<HealthResponse | null>(null)
const ready = ref<ReadyResponse | null>(null)
const llm = ref<LlmStatus | null>(null)
const ragflow = ref<RagflowStatus | null>(null)
const projects = ref<ProjectSummary[]>([])
const projectNote = ref('')
const serviceNote = ref('')

function tone(ok: boolean | undefined, emptyMeansWarn = false) {
  if (ok === undefined) return ''
  if (ok) return 'v-ok'
  return emptyMeansWarn ? 'v-warn' : 'v-bad'
}

function formatTime(value: string | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatEffort(minValue: ProjectSummary['effort_min_pm'], maxValue: ProjectSummary['effort_max_pm']) {
  if (minValue == null && maxValue == null) return '—'
  return `${minValue ?? '?'}–${maxValue ?? '?'}`
}

async function load() {
  loading.value = true
  serviceNote.value = ''
  projectNote.value = ''

  const [healthResult, readyResult, llmResult, ragflowResult, projectResult] = await Promise.allSettled([
    api.health(),
    api.ready(),
    api.llmStatus(),
    api.ragflowStatus(),
    api.projects(),
  ])

  health.value = healthResult.status === 'fulfilled' ? healthResult.value : null
  ready.value = readyResult.status === 'fulfilled' ? readyResult.value : null
  llm.value = llmResult.status === 'fulfilled' ? llmResult.value : null
  ragflow.value = ragflowResult.status === 'fulfilled' ? ragflowResult.value : null

  if (!health.value) {
    serviceNote.value = '服务未接通。请先启动后端。'
  }

  if (projectResult.status === 'fulfilled') {
    projects.value = projectResult.value.items
  } else {
    projects.value = []
    const reason = projectResult.reason
    projectNote.value =
      reason instanceof ApiError && reason.status === 503
        ? '数据库未就绪，列表暂时空着。'
        : '项目列表暂时读不到。'
  }

  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="headline">
      <div>
        <h1>工作台</h1>
        <p class="lede">先看环境是否就绪，再从项目列表里把需求聊清楚。</p>
      </div>
      <div class="tools">
        <button class="btn btn-outline btn-sm" type="button" :disabled="loading" @click="load">刷新</button>
        <RouterLink class="btn btn-primary btn-sm" to="/new">提出需求</RouterLink>
      </div>
    </div>

    <p v-if="serviceNote" class="note">{{ serviceNote }}</p>

    <div class="stones">
      <StatusStone
        label="服务"
        :value="health?.ok ? '正常' : loading ? '…' : '未接通'"
        :tone="tone(health?.ok)"
        shape="a"
      />
      <StatusStone
        label="数据库"
        :value="ready?.database.ready ? '已连接' : loading ? '…' : '未连接'"
        :tone="tone(ready?.database.ready)"
        shape="b"
      />
      <StatusStone
        label="模型"
        :value="llm?.apiKeyConfigured ? '已配置' : '未配置'"
        :meta="llm ? `${llm.provider} / ${llm.model}` : ''"
        :tone="tone(llm?.apiKeyConfigured, true)"
        shape="c"
      />
      <StatusStone
        label="检索"
        :value="ragflow?.enabled ? (ragflow.apiKeyConfigured ? '已启用' : '未配置密钥') : '关闭'"
        :tone="ragflow?.enabled ? tone(ragflow.apiKeyConfigured, true) : ''"
        shape="d"
      />
    </div>

    <UiCard shape="e">
      <div class="card-head">
        <h2>项目</h2>
        <span>{{ loading ? '读取中' : `${projects.length} 条` }}</span>
      </div>
      <p v-if="projectNote" class="note">{{ projectNote }}</p>
      <div v-else-if="!loading && !projects.length" class="empty">
        还没有项目。可以从右上角提出一条，或等数据库就绪后再看列表。
      </div>
      <div v-else-if="projects.length" class="grid-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>标题</th>
              <th>状态</th>
              <th>阶段</th>
              <th>优先级</th>
              <th>规模 / 风险</th>
              <th>人月</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in projects" :key="item.id" @click="router.push(`/projects/${item.id}`)">
              <td>
                <span class="title-cell">{{ item.title }}</span>
                <span class="sub-cell">{{ item.id }}</span>
              </td>
              <td>{{ item.status || '—' }}</td>
              <td>{{ item.current_stage || '—' }}</td>
              <td>
                {{ item.priority || '—' }}
                <span v-if="item.value_score != null" class="sub-cell">{{ item.value_score }} 分</span>
              </td>
              <td>{{ item.project_size || '—' }} / {{ item.risk_level || '—' }}</td>
              <td class="num">{{ formatEffort(item.effort_min_pm, item.effort_max_pm) }}</td>
              <td class="quiet num">{{ formatTime(item.updated_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>
  </div>
</template>
