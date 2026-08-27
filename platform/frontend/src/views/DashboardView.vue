<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  Inbox,
  Layers3,
  RefreshCw,
  Sparkles,
} from 'lucide-vue-next'
import { ApiError, api } from '../api/client'
import { useAuth } from '../auth'
import type { ProjectSummary } from '../api/types'


const router = useRouter()
const { isReviewer, user } = useAuth()
const loading = ref(true)
const projects = ref<ProjectSummary[]>([])
const error = ref('')
const reviewableProjects = computed(() =>
  projects.value.filter((item) => item.status === 'waiting_review' || item.status === 'needs_info'),
)
const activeProjects = computed(() =>
  projects.value.filter((item) => !['completed', '已完成'].includes(item.status)).length,
)

function formatTime(value: string | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    submitted: '已创建',
    clarifying: 'AI 澄清中',
    waiting_review: '等待评审',
    needs_info: '需要补充信息',
    completed: '已完成',
  }
  return labels[value] ?? value
}

function statusTone(value: string) {
  if (value === 'completed' || value === 'waiting_review') return 'ok'
  if (value === 'needs_info') return 'warn'
  return 'muted'
}

function reviewerPriority(item: ProjectSummary) {
  return item.priority ? `${item.priority} · ${item.value_score ?? '—'} 分` : '待确认画像'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    projects.value = (await api.projects()).items
  } catch (err) {
    projects.value = []
    error.value =
      err instanceof ApiError && err.status === 503
        ? 'MySQL 未就绪或 schema 未初始化，暂时无法读取需求。'
        : err instanceof Error
          ? err.message
          : '项目列表读取失败'
  } finally {
    loading.value = false
  }
}

function openProject(project: ProjectSummary) {
  router.push(`/projects/${project.id}`)
}

onMounted(load)
</script>

<template>
  <div class="dashboard-page">
    <div class="page-head">
      <div>
        <div class="page-kicker">{{ isReviewer ? 'Review workspace / 评审工作台' : 'My requests / 我的需求' }}</div>
        <h1>
          {{ isReviewer ? '从清晰画像开始评审' : '让每个需求，先被说清楚' }}
        </h1>
        <p class="sub">
          {{
            isReviewer
              ? '查看待评审需求的画像、价值、风险和工作量，并明确下一步处理意见。'
              : `你好，${user?.displayName ?? ''}。从一问一答开始，把业务想法整理成可评审的需求。`
          }}
        </p>
      </div>
      <div class="actions">
        <button class="btn" type="button" :disabled="loading" @click="load">
          <RefreshCw :size="15" :class="{ 'is-spinning': loading }" aria-hidden="true" />
          <span>刷新</span>
        </button>
        <RouterLink v-if="!isReviewer" class="btn btn-primary" to="/new">
          <FilePlus2 :size="15" aria-hidden="true" />
          <span>新建需求</span>
        </RouterLink>
      </div>
    </div>

    <p v-if="error" class="banner warn">{{ error }}</p>

    <section class="dashboard-hero compact-hero" aria-labelledby="dashboard-hero-title">
      <div class="dashboard-hero-copy">
        <div class="section-pill"><span aria-hidden="true"></span>{{ isReviewer ? 'Review queue / 评审队列' : 'Clarification / 前置澄清' }}</div>
        <h2 id="dashboard-hero-title">
          {{ isReviewer ? '事实、缺口和判断，一起看。' : '先聊天，再让方案有据可依。' }}
        </h2>
        <p>
          {{
            isReviewer
              ? 'AI 只负责梳理与评估；最终业务判断和评审结论由人确认并留痕。'
              : '材料上传可以跳过。先回答 AI 当前最重要的一个问题，需求画像会实时更新。'
          }}
        </p>
        <div class="dashboard-hero-metrics" aria-label="项目摘要">
          <div>
            <span>{{ isReviewer ? '全部需求' : '我的需求' }}</span>
            <strong>{{ projects.length }}</strong>
          </div>
          <div>
            <span>{{ isReviewer ? '待处理' : '进行中' }}</span>
            <strong>{{ isReviewer ? reviewableProjects.length : activeProjects }}</strong>
          </div>
          <div>
            <span>{{ isReviewer ? '需要补充' : '已完成' }}</span>
            <strong>{{ isReviewer ? projects.filter((item) => item.status === 'needs_info').length : projects.filter((item) => item.status === 'completed').length }}</strong>
          </div>
        </div>
      </div>
      <div class="dashboard-orbit" aria-hidden="true">
        <div class="orbit-card orbit-card-main">
          <div class="orbit-icon"><Sparkles :size="20" /></div>
          <div>
            <span>{{ isReviewer ? '评审流程' : 'AI 需求分析师' }}</span>
            <strong>{{ loading ? '同步中' : isReviewer ? '等待处理' : '一次一问' }}</strong>
          </div>
        </div>
        <div class="orbit-card orbit-card-top">
          <ClipboardCheck :size="15" />
          <span>{{ isReviewer ? '评审' : '画像' }}</span>
        </div>
        <div class="orbit-card orbit-card-bottom">
          <CheckCircle2 :size="15" />
          <span>项目 {{ projects.length }}</span>
        </div>
      </div>
    </section>

    <section class="card card-pad mt16 dashboard-list-card">
      <div class="section-heading">
        <div>
          <div class="section-label">{{ isReviewer ? 'All requests / 全部需求' : 'Your requests / 你的需求' }}</div>
          <div class="card-title mt8"><Layers3 :size="17" aria-hidden="true" />{{ isReviewer ? '评审列表' : '需求列表' }}</div>
          <div class="card-sub">
            {{ isReviewer ? '优先处理等待评审或需要补充信息的需求。' : '点击需求查看状态；AI 澄清是最直接的下一步。' }}
          </div>
        </div>
        <div class="muted text-sm">{{ loading ? '加载中…' : `共 ${projects.length} 条` }}</div>
      </div>

      <div v-if="!loading && !projects.length" class="empty">
        <div class="big"><Inbox :size="19" aria-hidden="true" /></div>
        {{ isReviewer ? '当前没有可查看的需求。' : '还没有需求项目，先创建一条并开始 AI 澄清。' }}
      </div>
      <div v-else-if="projects.length" class="table-wrap">
        <table class="req-table">
          <thead>
            <tr>
              <th>需求</th>
              <th>状态</th>
              <th>当前阶段</th>
              <th v-if="isReviewer">内部评估</th>
              <th>更新时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in projects"
              :key="item.id"
              class="rowlink"
              tabindex="0"
              :aria-label="`打开需求 ${item.title}`"
              @click="openProject(item)"
              @keydown.enter="openProject(item)"
              @keydown.space.prevent="openProject(item)"
            >
              <td>
                <div class="req-title">{{ item.title }}</div>
                <div class="req-meta">{{ item.id }}</div>
              </td>
              <td><span class="badge" :class="statusTone(item.status)">{{ statusLabel(item.status) }}</span></td>
              <td>{{ item.current_stage || '—' }}</td>
              <td v-if="isReviewer">
                <div class="req-title">{{ reviewerPriority(item) }}</div>
                <div class="req-meta">{{ item.project_size || '—' }} / {{ item.risk_level || '—' }}</div>
              </td>
              <td class="text-xs muted">{{ formatTime(item.updated_at) }}</td>
              <td><ArrowUpRight :size="16" aria-hidden="true" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
