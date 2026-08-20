<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ApiError, api } from '../api/client'
import type { ProjectSummary } from '../api/types'
import { usePlatformStatus } from '../composables/usePlatformStatus'

const { healthOk, refreshStatus } = usePlatformStatus()
const loading = ref(true)
const projects = ref<ProjectSummary[]>([])
const listError = ref('')

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
  listError.value = ''
  await refreshStatus()
  try {
    projects.value = (await api.projects()).items
  } catch (err) {
    projects.value = []
    listError.value =
      err instanceof ApiError && err.status === 503
        ? '数据库还没就绪，所以列表是空的。'
        : '项目列表暂时读不到。'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-bar">
      <h1>项目</h1>
      <div class="tools">
        <button class="btn" type="button" :disabled="loading" @click="load">刷新</button>
        <RouterLink class="btn btn-primary" to="/new">提出需求</RouterLink>
      </div>
    </div>

    <p v-if="healthOk === false" class="banner">后端还没接通。列表可能不完整。</p>
    <p v-else-if="listError" class="banner">{{ listError }}</p>

    <section class="list">
      <div class="list-meta">
        <span>从这里进详情、继续澄清。</span>
        <span>{{ loading ? '读取中' : `${projects.length} 条` }}</span>
      </div>
      <div v-if="!loading && !projects.length" class="empty">
        还没有项目。<RouterLink to="/new">提出一条需求</RouterLink>
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
          <tr v-for="item in projects" :key="item.id">
            <td class="title-cell">
              <RouterLink :to="`/projects/${item.id}`">{{ item.title }}</RouterLink>
              <span class="sub">{{ item.id }}</span>
            </td>
            <td>{{ item.status || '—' }}</td>
            <td>{{ item.current_stage || '—' }}</td>
            <td>
              {{ item.priority || '—' }}
              <span v-if="item.value_score != null" class="sub">{{ item.value_score }} 分</span>
            </td>
            <td>{{ item.project_size || '—' }} / {{ item.risk_level || '—' }}</td>
            <td class="num">{{ formatEffort(item.effort_min_pm, item.effort_max_pm) }}</td>
            <td class="num">{{ formatTime(item.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
