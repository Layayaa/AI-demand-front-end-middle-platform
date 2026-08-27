<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FilePenLine,
  FolderOpen,
  List,
  Paperclip,
  RefreshCw,
  SendToBack,
  Upload,
  ExternalLink,
} from 'lucide-vue-next'
import { api } from '../api/client'
import { useAuth } from '../auth'
import type {
  GeneratedDocument,
  Project,
  ProjectAssessment,
  ReviewFeedback,
  SourceFile,
} from '../api/types'
import StatusBadge from '../components/StatusBadge.vue'


const route = useRoute()
const { isReviewer } = useAuth()
const projectId = computed(() => String(route.params.id || ''))
const loading = ref(true)
const filesLoading = ref(false)
const uploading = ref(false)
const reviewing = ref(false)
const documentsLoading = ref(false)
const generatingDocuments = ref(false)
const error = ref('')
const fileError = ref('')
const reviewError = ref('')
const documentError = ref('')
const project = ref<Project | null>(null)
const files = ref<SourceFile[]>([])
const assessment = ref<ProjectAssessment | null>(null)
const feedback = ref<ReviewFeedback[]>([])
const documents = ref<GeneratedDocument[]>([])
const selectedDocumentId = ref('')
const explanationExpanded = ref(false)
const openingFileId = ref('')
const reviewForm = reactive({
  action: 'request_info' as 'request_info' | 'approve',
  note: '',
})

const requesterCanClarify = computed(() =>
  project.value && !['waiting_review', 'completed'].includes(project.value.status),
)

const explanationDocument = computed(() =>
  documents.value.find((item) => item.tier === 'requirement_explanation') ?? null,
)

const solutionDocuments = computed(() =>
  documents.value.filter((item) => item.tier === 'semi_auto' || item.tier === 'full_auto'),
)

type SolutionTier = 'semi_auto' | 'full_auto'
type SolutionDocumentType = 'product' | 'tech'

const solutionChoices: Array<{
  tier: SolutionTier
  label: string
  fit: string
  mode: string
  human: string
  upgrade: string
  dependencies: string
  risks: string
}> = [
  {
    tier: 'semi_auto',
    label: '半自动方案',
    fit: '规则还在验证，先覆盖一个明确范围',
    mode: '系统生成建议，业务确认后执行',
    human: '确认、改写、异常处理',
    upgrade: '数据口径和规则稳定后',
    dependencies: '数据可导入，规则可解释',
    risks: '人工确认仍占时间',
  },
  {
    tier: 'full_auto',
    label: '全自动方案',
    fit: '数据、规则、权限和异常边界已明确',
    mode: '系统自动触发、处理并回写',
    human: '越权、异常、失败时接管',
    upgrade: '适合正式规模化落地',
    dependencies: '接口、权限和规则稳定',
    risks: '口径或异常遗漏会放大影响',
  },
]

const selectedDocument = computed(() =>
  solutionDocuments.value.find((item) => item.id === selectedDocumentId.value) ?? solutionDocuments.value[0] ?? null,
)

const selectedDocumentOutline = computed(() => {
  const document = selectedDocument.value
  if (!document) return []
  return document.markdown_content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line, index) => {
      const match = line.trim().match(/^(#{2,4})\s+(.+)$/)
      if (!match) return null
      return {
        id: `doc-heading-${index}`,
        level: match[1].length,
        title: match[2].replace(/[*_`]/g, '').trim(),
      }
    })
    .filter(Boolean) as Array<{ id: string; level: number; title: string }>
})

function formatTime(value: string | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function requirementTypeLabel(value: Project['requirement_type']) {
  if (value === 'decision') return '单点决策'
  if (value === 'sop') return 'SOP 流程'
  return '待 AI 判断'
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

function fileSize(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function parseStatusLabel(value: string) {
  if (value === 'parsed') return '已解析'
  if (value === 'stored') return '已保存，待识别'
  return '解析失败'
}

function parseStatusTone(value: string) {
  if (value === 'parsed') return 'ok'
  if (value === 'stored') return 'warn'
  return 'off'
}

function canPreviewFile(file: SourceFile) {
  return (
    file.mime_type?.startsWith('image/') ||
    file.mime_type === 'application/pdf' ||
    ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(file.parser_type ?? '')
  )
}

async function openProjectFile(file: SourceFile) {
  if (openingFileId.value) return

  const previewWindow = canPreviewFile(file) ? window.open('', '_blank') : null
  openingFileId.value = file.id
  fileError.value = ''
  try {
    const blob = await api.projectFileBlob(projectId.value, file.id)
    const url = URL.createObjectURL(blob)
    if (previewWindow) {
      previewWindow.location.href = url
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return
    }

    const link = document.createElement('a')
    link.href = url
    link.download = file.original_filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err) {
    previewWindow?.close()
    fileError.value = err instanceof Error ? err.message : '附件打开失败'
  } finally {
    openingFileId.value = ''
  }
}

async function downloadDocument(planDocument: GeneratedDocument) {
  documentError.value = ''
  try {
    const blob = await api.projectDocumentBlob(projectId.value, planDocument.id)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.value?.title ?? '需求'}-${planDocument.title}-V${planDocument.version}.docx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err) {
    documentError.value = err instanceof Error ? err.message : 'DOCX 下载失败'
  }
}

function planTierLabel(value: GeneratedDocument['tier']) {
  if (value === 'requirement_explanation') return '需求解释方案'
  return value === 'full_auto' ? '全自动（复杂版）' : '半自动（简单版）'
}

function documentTypeLabel(value: GeneratedDocument['document_type']) {
  if (value === 'explanation') return '说明版'
  return value === 'tech' ? '技术版' : '产品版'
}

function documentModelLabel(document: GeneratedDocument | null) {
  if (!document?.model_name || document.model_name === 'builtin_template') return '模板底稿'
  return document.model_name
}

function openSolution(tier: SolutionTier, documentType: SolutionDocumentType) {
  const document = solutionDocuments.value.find(
    (item) => item.tier === tier && item.document_type === documentType,
  )
  if (document) selectedDocumentId.value = document.id
}

function selectedSolutionTier(): SolutionTier {
  return selectedDocument.value?.tier === 'full_auto' ? 'full_auto' : 'semi_auto'
}

function selectedSolutionDocumentType(): SolutionDocumentType {
  return selectedDocument.value?.document_type === 'tech' ? 'tech' : 'product'
}

function scrollToOutline(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
}

function tableCells(value: string) {
  const row = value.trim().replace(/^\|/, '').replace(/\|$/, '')
  return row.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim())
}

function isTableSeparator(value: string) {
  const cells = tableCells(value)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function renderPlanMarkdown(markdown: string) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let paragraph: string[] = []
  let quote: string[] = []
  let titleSkipped = false
  let code: string[] | null = null

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`)
      listType = null
    }
  }

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }

  const flushQuote = () => {
    if (quote.length) {
      html.push(`<blockquote>${quote.map((line) => `<p>${inlineMarkdown(line)}</p>`).join('')}</blockquote>`)
      quote = []
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const line = rawLine.trim()
    if (code) {
      if (line.startsWith('```')) {
        html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
        code = null
      } else {
        code.push(rawLine)
      }
      continue
    }
    if (line.startsWith('```')) {
      flushParagraph()
      flushQuote()
      closeList()
      code = []
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    const unordered = line.match(/^[-*+]\s+(.+)$/)
    const ordered = line.match(/^\d+\.\s+(.+)$/)
    const quoted = line.match(/^>\s?(.*)$/)

    if (!line) {
      flushParagraph()
      flushQuote()
      closeList()
      continue
    }

    if (heading) {
      flushParagraph()
      flushQuote()
      closeList()
      if (heading[1] === '#' && !titleSkipped) {
        titleSkipped = true
        continue
      }
      const level = Math.min(6, heading[1].length)
      html.push(`<h${level} id="doc-heading-${index}">${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    if (quoted) {
      flushParagraph()
      closeList()
      quote.push(quoted[1])
      continue
    }

    if (unordered || ordered) {
      flushParagraph()
      flushQuote()
      const nextType = unordered ? 'ul' : 'ol'
      if (listType !== nextType) {
        closeList()
        listType = nextType
        html.push(`<${listType}>`)
      }
      html.push(`<li>${inlineMarkdown((unordered ?? ordered)![1])}</li>`)
      continue
    }

    if (line.startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1].trim())) {
      flushParagraph()
      flushQuote()
      closeList()
      const header = tableCells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(tableCells(lines[index]))
        index += 1
      }
      index -= 1
      html.push(
        `<div class="plan-table-wrap"><table><thead><tr>${header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map((row) => `<tr>${header.map((_, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      )
      continue
    }

    flushQuote()
    closeList()
    paragraph.push(line)
  }

  flushParagraph()
  flushQuote()
  closeList()
  if (code) html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  return html.join('')
}

async function loadProject() {
  project.value = await api.project(projectId.value)
}

async function loadFiles() {
  filesLoading.value = true
  fileError.value = ''
  try {
    files.value = (await api.projectFiles(projectId.value)).items
  } catch (err) {
    fileError.value = err instanceof Error ? err.message : '材料列表读取失败'
  } finally {
    filesLoading.value = false
  }
}

async function loadReviewerData() {
  if (!isReviewer.value) return
  const [assessmentResult, feedbackResult] = await Promise.allSettled([
    api.projectAssessment(projectId.value),
    api.reviewFeedback(projectId.value),
  ])
  assessment.value = assessmentResult.status === 'fulfilled' ? assessmentResult.value : null
  feedback.value = feedbackResult.status === 'fulfilled' ? feedbackResult.value.items : []
}

async function loadDocuments() {
  documentsLoading.value = true
  documentError.value = ''
  try {
    documents.value = (await api.projectDocuments(projectId.value)).items
    if (!solutionDocuments.value.some((item) => item.id === selectedDocumentId.value)) {
      selectedDocumentId.value =
        solutionDocuments.value.find((item) => item.tier === 'semi_auto' && item.document_type === 'product')?.id ??
        solutionDocuments.value[0]?.id ??
        ''
    }
  } catch (err) {
    documentError.value = err instanceof Error ? err.message : '方案读取失败'
  } finally {
    documentsLoading.value = false
  }
}

async function load() {
  loading.value = true
  error.value = ''
  assessment.value = null
  feedback.value = []
  documents.value = []
  selectedDocumentId.value = ''
  explanationExpanded.value = false
  try {
    await loadProject()
    await Promise.all([loadFiles(), loadReviewerData(), loadDocuments()])
  } catch (err) {
    error.value = err instanceof Error ? err.message : '项目读取失败'
  } finally {
    loading.value = false
  }
}

async function generateDocuments() {
  generatingDocuments.value = true
  documentError.value = ''
  try {
    documents.value = (await api.generateProjectDocuments(projectId.value)).items
    selectedDocumentId.value =
      solutionDocuments.value.find((item) => item.tier === 'semi_auto' && item.document_type === 'product')?.id ??
      solutionDocuments.value[0]?.id ??
      ''
  } catch (err) {
    documentError.value = err instanceof Error ? err.message : '方案生成失败'
  } finally {
    generatingDocuments.value = false
  }
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  uploading.value = true
  fileError.value = ''
  try {
    await api.uploadProjectFile(projectId.value, file)
    await loadFiles()
  } catch (err) {
    fileError.value = err instanceof Error ? err.message : '材料上传失败'
  } finally {
    uploading.value = false
  }
}

async function submitReview() {
  if (!reviewForm.note.trim()) {
    reviewError.value = '请填写评审意见。'
    return
  }
  reviewing.value = true
  reviewError.value = ''
  try {
    await api.reviewProject(projectId.value, {
      action: reviewForm.action,
      note: reviewForm.note.trim(),
    })
    reviewForm.note = ''
    await load()
  } catch (err) {
    reviewError.value = err instanceof Error ? err.message : '提交评审失败'
  } finally {
    reviewing.value = false
  }
}

onMounted(load)
watch(projectId, load)
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="page-kicker">{{ isReviewer ? 'Review detail / 评审详情' : 'My request / 我的需求' }}</div>
        <h1>{{ isReviewer ? '需求评审' : '需求详情' }}</h1>
        <p class="sub">
          {{
            isReviewer
              ? '查看事实、需求画像和内部评估后，给出明确的处理意见。'
              : 'AI 澄清是主流程；上传材料可选，用于补充当前需求的业务事实。'
          }}
        </p>
      </div>
      <RouterLink class="btn" to="/">
        <ArrowLeft :size="15" aria-hidden="true" />
        <span>返回工作台</span>
      </RouterLink>
    </div>

    <p v-if="error" class="banner warn">{{ error }}</p>

    <section class="card project-hero">
      <div v-if="loading" class="empty">正在读取项目…</div>
      <template v-else-if="project">
        <div class="flex-between">
          <div>
            <div class="section-label">Project context / 项目上下文</div>
            <div class="project-title mt8">{{ project.title }}</div>
            <p class="project-id">PROJECT ID <code>{{ project.id }}</code></p>
          </div>
          <StatusBadge :tone="statusTone(project.status)" :label="statusLabel(project.status)" />
        </div>
        <p class="project-summary">{{ project.summary || '尚未填写需求摘要。可以直接开始 AI 澄清，也可以补充材料。' }}</p>
        <dl class="project-facts">
          <div class="project-fact">
            <dt>提出部门</dt>
            <dd>{{ project.department || '—' }}</dd>
          </div>
          <div class="project-fact">
            <dt>需求形态 / 当前阶段</dt>
            <dd>{{ requirementTypeLabel(project.requirement_type) }} · {{ project.current_stage || '—' }}</dd>
          </div>
          <div class="project-fact">
            <dt>最近更新时间</dt>
            <dd>{{ formatTime(project.updated_at) }}</dd>
          </div>
        </dl>

        <RouterLink
          v-if="!isReviewer && requesterCanClarify"
          class="btn btn-primary clarify-cta"
          :to="`/projects/${project.id}/clarify`"
        >
          <FilePenLine :size="17" aria-hidden="true" />
          <span>{{ project.status === 'needs_info' ? '补充评审问题' : '开始 AI 澄清' }}</span>
        </RouterLink>
        <p v-else-if="!isReviewer" class="project-status-note">
          {{ project.status === 'completed' ? '该需求已完成。' : '需求已进入评审，等待评审人反馈。' }}
        </p>
      </template>
      <div v-else-if="!error" class="empty">项目不存在或尚未加载。</div>
    </section>

    <section v-if="isReviewer && project" class="review-grid mt16">
      <section class="card card-pad">
        <div class="section-label">Internal assessment / 内部评估</div>
        <div v-if="assessment" class="assessment-summary">
          <div>
            <span>优先级</span>
            <strong>{{ assessment.priority }}</strong>
          </div>
          <div>
            <span>价值评分</span>
            <strong>{{ assessment.value_score }}</strong>
          </div>
          <div>
            <span>工作量</span>
            <strong>{{ assessment.effort_min_pm }}-{{ assessment.effort_max_pm }} 人月</strong>
          </div>
        </div>
        <p v-if="assessment" class="card-sub mt16">{{ assessment.summary }}</p>
        <div v-if="assessment" class="assessment-origin mt16">
          <StatusBadge
            :tone="assessment.assessment_source === 'llm' ? 'ok' : 'warn'"
            :label="assessment.assessment_source === 'llm' ? '模型参与评估' : '规则兜底评估'"
          />
          <span>业务关键性：{{ assessment.business_criticality }}</span>
          <span v-if="assessment.assessment_model">模型：{{ assessment.assessment_model }}</span>
        </div>
        <details
          v-if="assessment?.assessment_rationale?.length || assessment?.assessment_evidence_gaps?.length || assessment?.dimensions?.length"
          class="assessment-evidence"
        >
          <summary>依据 / Evidence</summary>
          <div v-if="assessment?.assessment_rationale?.length" class="assessment-rationale">
            <strong>模型判断依据</strong>
            <ul>
              <li v-for="item in assessment.assessment_rationale" :key="item">{{ item }}</li>
            </ul>
          </div>
          <div v-if="assessment?.assessment_evidence_gaps?.length" class="assessment-evidence-gaps">
            <strong>仍需补证</strong>
            <span v-for="item in assessment.assessment_evidence_gaps" :key="item">{{ item }}</span>
          </div>
          <div v-if="assessment?.dimensions?.length" class="assessment-dimensions">
            <div v-for="dimension in assessment.dimensions" :key="dimension.name">
              <div><strong>{{ dimension.name }}</strong><span>{{ dimension.score }}</span></div>
              <p>{{ dimension.evidence }}</p>
            </div>
          </div>
        </details>
        <p v-else class="card-sub">需求人确认画像后，系统才生成内部价值、规模和风险评估。</p>
      </section>

      <section class="card card-pad">
        <div class="section-label">Review decision / 评审处理</div>
        <div class="card-title mt8">给需求人一个明确的下一步</div>
        <form class="form review-form" @submit.prevent="submitReview">
          <label>
            处理方式
            <select v-model="reviewForm.action">
              <option value="request_info">退回补充信息</option>
              <option value="approve">确认完成</option>
            </select>
          </label>
          <label>
            评审意见
            <textarea
              v-model="reviewForm.note"
              rows="5"
              :placeholder="reviewForm.action === 'request_info' ? '明确写出需要补充的事实、口径或边界。' : '写明确认结论或后续交接说明。'"
            />
          </label>
          <button class="btn btn-primary" type="submit" :disabled="reviewing || !assessment">
            <SendToBack v-if="reviewForm.action === 'request_info'" :size="16" aria-hidden="true" />
            <CheckCircle2 v-else :size="16" aria-hidden="true" />
            <span>{{ reviewing ? '提交中…' : reviewForm.action === 'request_info' ? '退回补充' : '确认完成' }}</span>
          </button>
        </form>
        <p v-if="reviewError" class="banner warn mt16">{{ reviewError }}</p>
      </section>
    </section>

    <section v-if="isReviewer && feedback.length" class="card card-pad mt16">
      <div class="section-label">Review history / 评审记录</div>
      <div class="feedback-list mt16">
        <article v-for="item in feedback" :key="item.id" class="feedback-item">
          <div>
            <strong>{{ item.action === 'request_info' ? '退回补充' : '确认完成' }}</strong>
            <span>{{ item.reviewer_name }} · {{ formatTime(item.created_at) }}</span>
          </div>
          <p>{{ item.note }}</p>
        </article>
      </div>
    </section>

    <section v-if="project" class="card card-pad mt16 plan-section">
      <div class="flex-between">
        <div>
          <div class="section-label">Requirement plans / 需求方案</div>
          <div class="card-title mt8">先解释需求，再给解决方案</div>
          <p class="card-sub">
            {{ isReviewer ? '需求解释方案用于评审确认；通过后才生成四份解决方案。' : '确认画像后先查看需求解释方案；评审确认后可查看四份解决方案。' }}
          </p>
        </div>
        <button
          v-if="isReviewer && project.status === 'completed'"
          class="btn"
          type="button"
          :disabled="generatingDocuments || !assessment"
          @click="generateDocuments"
        >
          <RefreshCw v-if="!generatingDocuments" :size="15" aria-hidden="true" />
          <span>{{ generatingDocuments ? '生成中…' : solutionDocuments.length ? '重新生成方案' : '生成四份方案' }}</span>
        </button>
      </div>

      <p v-if="documentError" class="banner warn mt16">{{ documentError }}</p>
      <div v-else-if="documentsLoading" class="empty">正在读取方案…</div>
      <div v-else class="plan-view mt16">
        <article v-if="explanationDocument" class="plan-document plan-explanation">
          <div class="plan-document-head explanation-head">
            <div>
              <div class="section-label">Requirement explanation / 需求解释</div>
              <h2>{{ explanationDocument.title }}</h2>
              <p class="document-meta">
                V{{ explanationDocument?.version }} · {{ documentModelLabel(explanationDocument) }} · {{ formatTime(explanationDocument?.created_at) }}
              </p>
              <p class="explanation-summary">
                {{ project?.summary || '用于确认需求目标、当前做法和评审边界。' }}
              </p>
            </div>
            <div class="explanation-head-actions">
              <span class="badge muted">V{{ explanationDocument?.version }}</span>
              <button class="btn secondary" type="button" @click="downloadDocument(explanationDocument)">导出 DOCX</button>
              <button
                class="plan-collapse-toggle"
                type="button"
                :aria-expanded="explanationExpanded"
                aria-controls="requirement-explanation-body"
                @click="explanationExpanded = !explanationExpanded"
              >
                <ChevronDown :size="15" :class="{ rotated: explanationExpanded }" aria-hidden="true" />
                <span>{{ explanationExpanded ? '收起' : '展开' }}</span>
              </button>
            </div>
          </div>
          <div v-if="explanationExpanded" id="requirement-explanation-body" class="explanation-body">
            <div class="plan-markdown" v-html="renderPlanMarkdown(explanationDocument?.markdown_content || '')" />
          </div>
        </article>
        <p v-else class="plan-pending">
          需求人确认画像后，这里会先生成一份需求解释方案，供双方确认理解是否一致。
        </p>

        <div v-if="solutionDocuments.length && selectedDocument" class="solution-plans">
          <div class="section-rule">
            <div>
              <div class="section-label">Solution plans / 需求解决方案</div>
              <div class="card-title mt8">先看推荐，再看产品或技术选型</div>
              <p class="card-sub">这里帮助评审人选方向，不替代后续完成的详细需求方案。</p>
            </div>
          </div>
          <div class="solution-recommendation">
            <div class="solution-recommendation-label">推荐先做</div>
            <div class="solution-recommendation-main">
              <span class="badge warn">半自动方案</span>
              <strong>先验证规则和收益</strong>
            </div>
            <p>先让系统生成建议，由业务确认后执行；数据、权限和异常边界稳定后，再升级全自动。</p>
          </div>
          <div class="solution-overview">
            <div class="section-label">方案对照</div>
            <div class="solution-comparison-wrap">
              <table class="solution-comparison">
                <thead>
                  <tr>
                    <th>方案</th>
                    <th>适用条件</th>
                    <th>系统负责</th>
                    <th>人工负责</th>
                    <th>关键依赖</th>
                    <th>主要风险</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="choice in solutionChoices" :key="choice.tier">
                    <th>
                      <button
                        type="button"
                        class="solution-table-select"
                        :class="{ active: selectedDocument.tier === choice.tier }"
                        @click="openSolution(choice.tier, 'product')"
                      >
                        {{ choice.label }}
                      </button>
                    </th>
                    <td>{{ choice.fit }}</td>
                    <td>{{ choice.mode }}</td>
                    <td>{{ choice.human }}</td>
                    <td>{{ choice.dependencies }}</td>
                    <td>{{ choice.risks }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="solution-selection-note">选择半自动：先验证流程和规则。选择全自动：确认数据、权限和异常边界后直接规模化。</p>
          </div>
          <div class="solution-controls">
            <div class="solution-control-group" role="tablist" aria-label="方案档位">
              <span class="solution-control-label">方案</span>
              <button
                v-for="choice in solutionChoices"
                :key="choice.tier"
                type="button"
                class="solution-segment"
                :class="{ active: selectedDocument.tier === choice.tier }"
                @click="openSolution(choice.tier, selectedSolutionDocumentType())"
              >
                {{ choice.label }}
              </button>
            </div>
            <div class="solution-control-group" role="tablist" aria-label="方案视角">
              <span class="solution-control-label">视角</span>
              <button
                type="button"
                class="solution-segment"
                :class="{ active: selectedSolutionDocumentType() === 'product' }"
                @click="openSolution(selectedSolutionTier(), 'product')"
              >
                产品选型
              </button>
              <button
                type="button"
                class="solution-segment"
                :class="{ active: selectedSolutionDocumentType() === 'tech' }"
                @click="openSolution(selectedSolutionTier(), 'tech')"
              >
                技术选型
              </button>
            </div>
          </div>
          <div class="document-reading-layout">
            <nav v-if="selectedDocumentOutline.length" class="document-outline" aria-label="文档目录">
              <div class="section-label"><List :size="13" aria-hidden="true" />文档目录</div>
              <button
                v-for="item in selectedDocumentOutline"
                :key="item.id"
                type="button"
                :class="{ nested: item.level > 2 }"
                @click="scrollToOutline(item.id)"
              >
                <ChevronRight :size="12" aria-hidden="true" />
                <span>{{ item.title }}</span>
              </button>
            </nav>
            <article class="plan-document">
              <div class="plan-document-head">
                <div>
                  <div class="section-label">{{ planTierLabel(selectedDocument.tier) }} / {{ documentTypeLabel(selectedDocument.document_type) }}</div>
                  <h2>{{ selectedDocument.title }}</h2>
                  <p class="document-meta">
                    V{{ selectedDocument.version }} · {{ documentModelLabel(selectedDocument) }} · {{ formatTime(selectedDocument.created_at) }}
                  </p>
                </div>
                <div class="flex gap8">
                  <span class="badge muted">V{{ selectedDocument.version }}</span>
                  <button class="btn secondary" type="button" @click="downloadDocument(selectedDocument)">导出 DOCX</button>
                </div>
              </div>
              <div class="plan-markdown" v-html="renderPlanMarkdown(selectedDocument.markdown_content)" />
	            </article>
	          </div>
	        </div>
        <p v-else class="plan-pending">
          评审人确认需求后，平台会生成半自动与全自动各自的产品版和技术版，共 4 份解决方案。
        </p>
      </div>
    </section>

    <section v-if="!isReviewer" class="card card-pad mt16">
      <div class="flex-between">
        <div>
          <div class="section-rule"><div class="section-label">Optional material / 可选材料</div><FolderOpen :size="16" aria-hidden="true" /></div>
          <div class="card-title">补充业务事实</div>
          <p class="card-sub">支持 Word、PDF、Excel、CSV、TXT、MD 和图片。材料不是澄清的前置条件。</p>
        </div>
        <label class="btn file-button">
          <Upload v-if="!uploading" :size="15" aria-hidden="true" />
          {{ uploading ? '上传中…' : '上传材料' }}
          <input
            type="file"
            accept=".docx,.pdf,.txt,.md,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.gif,.bmp"
            :disabled="uploading"
            @change="onFileChange"
          />
        </label>
      </div>

      <p v-if="fileError" class="banner warn mt16">{{ fileError }}</p>
      <div v-if="filesLoading" class="empty">正在读取材料…</div>
      <div v-else-if="!files.length" class="empty">
        <div class="big"><Paperclip :size="19" aria-hidden="true" /></div>
        还没有上传材料。可以直接开始 AI 澄清。
      </div>
      <div v-else class="file-list mt16">
        <article v-for="item in files" :key="item.id" class="file-item">
          <div class="flex-between">
            <div>
              <div class="req-title">{{ item.original_filename }}</div>
              <div class="req-meta">
                {{ item.parser_type?.toUpperCase() || '未知类型' }} · {{ fileSize(item.file_size) }} ·
                {{ item.text_length }} 字 · {{ formatTime(item.created_at) }}
              </div>
            </div>
            <span class="badge" :class="parseStatusTone(item.parse_status)">
              {{ parseStatusLabel(item.parse_status) }}
            </span>
          </div>
          <p v-if="item.text_preview" class="file-preview">{{ item.text_preview }}</p>
          <p v-else class="file-preview muted">
            {{ item.parser_metadata?.error || '该文件未提取到文本。' }}
          </p>
        </article>
      </div>
    </section>

    <section v-else-if="isReviewer && files.length" class="card card-pad mt16">
      <div class="flex-between">
        <div>
          <div class="section-label">Project material / 项目材料</div>
          <p class="card-sub mt8">点击附件右侧按钮查看原文件。</p>
        </div>
      </div>
      <div class="file-list mt16">
        <article v-for="item in files" :key="item.id" class="file-item">
          <div class="file-item-head">
            <div class="file-item-copy">
              <div class="req-title">{{ item.original_filename }}</div>
              <div class="req-meta">
                {{ item.parser_type?.toUpperCase() || '未知类型' }} · {{ fileSize(item.file_size) }} ·
                {{ item.text_length }} 字 · {{ formatTime(item.created_at) }}
              </div>
            </div>
            <button
              class="btn file-action"
              type="button"
              :disabled="openingFileId !== ''"
              :title="canPreviewFile(item) ? '在新标签页打开附件' : '下载附件'"
              @click="openProjectFile(item)"
            >
              <Download v-if="!canPreviewFile(item)" :size="15" aria-hidden="true" />
              <ExternalLink v-else :size="15" aria-hidden="true" />
              <span>
                {{
                  openingFileId === item.id
                    ? '处理中…'
                    : canPreviewFile(item)
                      ? '打开'
                      : '下载'
                }}
              </span>
            </button>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
