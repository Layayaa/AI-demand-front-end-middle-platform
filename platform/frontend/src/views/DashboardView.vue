<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { ApiError, api } from '../api/client'
import type { HealthResponse, LlmStatus, ProjectSummary, RagflowStatus, ReadyResponse } from '../api/types'

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
  <div>
    <div class="kicker">Workbench</div>
    <div class="headline">
      <h1>工作台</h1>
      <div class="tools">
        <button class="btn" type="button" :disabled="loading" @click="load">刷新</button>
        <RouterLink class="btn btn-solid" to="/new">提出需求</RouterLink>
      </div>
    </div>

    <p v-if="serviceNote" class="note">{{ serviceNote }}</p>

    <div class="status-line">
      <div class="status-item">
        服务
        <b :class="tone(health?.ok)">{{ health?.ok ? '正常' : loading ? '…' : '未接通' }}</b>
      </div>
      <div class="status-item">
        数据库
        <b :class="tone(ready?.database.ready)">{{ ready?.database.ready ? '已连接' : loading ? '…' : '未连接' }}</b>
      </div>
      <div class="status-item">
        模型
        <b :class="tone(llm?.apiKeyConfigured, true)">{{ llm?.apiKeyConfigured ? '已配置' : '未配置' }}</b>
        <span class="faint">{{ llm ? `${llm.provider} / ${llm.model}` : '' }}</span>
      </div>
      <div class="status-item">
        检索
        <b :class="ragflow?.enabled ? tone(ragflow.apiKeyConfigured, true) : ''">
          {{ ragflow?.enabled ? (ragflow.apiKeyConfigured ? '已启用' : '未配置密钥') : '关闭' }}
        </b>
      </div>
    </div>

    <div class="list-head">
      <h2>项目</h2>
      <span>{{ loading ? '读取中' : `${projects.length} 条` }}</span>
    </div>

    <p v-if="projectNote" class="note">{{ projectNote }}</p>

    <div v-else-if="!loading && !projects.length" class="empty">
      还没有项目。可以从右上角提出一条需求，或等数据库就绪后再看列表。
    </div>

    <table v-else-if="projects.length" class="grid">
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
</template>
