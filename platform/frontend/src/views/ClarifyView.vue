<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, CheckCircle2, Paperclip, Send, Sparkles, X } from 'lucide-vue-next'
import { api } from '../api/client'
import type {
  ClarificationSession,
  ClarificationStreamEvent,
  ConversationTurn,
  SourceFile,
  MaterialCandidate,
} from '../api/types'


const route = useRoute()
const projectId = computed(() => String(route.params.id || ''))
const loading = ref(true)
const sending = ref(false)
const error = ref('')
const answer = ref('')
const streamStatus = ref('')
const streamingAssistant = ref('')
const selectedAttachments = ref<File[]>([])
const uploadingAttachments = ref(false)
const attachmentError = ref('')
const clarification = ref<ClarificationSession | null>(null)
const transcript = ref<HTMLElement | null>(null)
const answeringQuestion = ref('')
const resolvingCandidateId = ref('')

const canReply = computed(() => {
  const current = clarification.value
  if (!current) return false
  return !['waiting_review', 'completed'].includes(current.projectStatus)
})

const isConfirming = computed(() => clarification.value?.next.stage === 'confirm')
const chatTitle = computed(() => {
  if (streamingAssistant.value) return 'AI 正在组织下一步问题'
  if (sending.value) return 'AI 正在分析你的回答'
  return clarification.value?.projectStage === 'review' ? '已进入等待评审' : 'AI 正在澄清需求'
})

const replyChips = computed(() =>
  clarification.value?.next.chips.filter((chip) => chip !== '确认需求画像') ?? [],
)

const canSend = computed(() =>
  !sending.value && Boolean(answer.value.trim() || selectedAttachments.value.length),
)

const profileTitle = computed(() => {
  const type = clarification.value?.profile.type
  return type === 'decision' ? '单点决策画像' : type === 'sop' ? 'SOP 流程画像' : '待判断需求形态'
})

const currentQuestion = computed(() => {
  if (sending.value && answeringQuestion.value) return answeringQuestion.value
  return clarification.value?.next.stage === 'clarifying'
    ? clarification.value.next.content
    : ''
})

const businessChainLabels: Record<string, string> = {
  inventory_operations: '商品、库存与商品后台运营',
  product_voc: '商品优化与客户 VOC',
  order_finance: '订单、财务与单据协同',
  training: '培训与组织学习',
  other: '其他业务链路',
}

const businessContext = computed(() => clarification.value?.profile.businessContext)

const businessChain = computed(() => {
  const value = businessContext.value?.businessChain
  return value ? (businessChainLabels[value] ?? value) : '待确认'
})

const initialInference = computed(() => {
  const value = businessContext.value?.candidateBusinessChain
  if (!value) return ''
  return businessChainLabels[value] ?? value
})

const confirmedBusinessFacts = computed(() => {
  const context = businessContext.value
  if (!context) return []
  return [
    ['业务对象', context.businessObject],
    ['适用范围', context.scope],
    ['当前处理方式', context.currentProcess],
    ['数据口径', context.dataDefinition],
    ['实际系统', context.systemLandscape],
    ['审批边界', context.approvalBoundary],
    ['成功标准', context.successMetric],
  ].filter(([, value]) => Boolean(value)) as Array<[string, string]>
})

const profileFacts = computed(() => {
  const profile = clarification.value?.profile
  if (!profile) return []
  const target = profile.type === 'decision' ? profile.decision : profile.sop
  const value = target.value as { level?: string } | undefined
  const frequency = target.frequency as { n?: string; unit?: string } | undefined
  return [
    ['名称', valueOf(target.name)],
    ['部门', valueOf(target.department)],
    [profile.type === 'decision' ? '决策人' : '负责人', valueOf(target.decisionMaker ?? target.owner)],
    ['频率', frequency ? `${frequency.n ?? 1} 次/${frequency.unit ?? '待确认'}` : '待确认'],
    ['价值', value?.level ?? '待确认'],
    ['目的', valueOf(target.purpose)],
  ]
})

const materialCandidates = computed(() =>
  (clarification.value?.profile.materialCandidates ?? []).filter((item) =>
    ['pending', 'conflict'].includes(item.status),
  ),
)

const candidateFieldLabels: Record<string, string> = {
  businessObject: '业务对象',
  scope: '适用范围',
  currentProcess: '当前处理方式',
  dataDefinition: '数据口径',
  systemLandscape: '涉及系统',
  approvalBoundary: '人工/审批边界',
  successMetric: '成功指标',
  purpose: '需求目的',
  steps: '流程步骤',
}

function candidateValue(candidate: MaterialCandidate) {
  if (Array.isArray(candidate.value)) {
    return candidate.value
      .map((item) => typeof item === 'object' && item && 'description' in item
        ? String((item as { description: unknown }).description)
        : String(item))
      .join('；')
  }
  return String(candidate.value ?? '')
}

async function resolveCandidate(candidate: MaterialCandidate, action: 'accept' | 'edit' | 'reject') {
  if (resolvingCandidateId.value) return
  let value: unknown = undefined
  if (action === 'edit') {
    const edited = window.prompt('修改后写入正式需求画像：', candidateValue(candidate))
    if (edited === null) return
    value = edited.trim()
    if (!value) return
  }
  resolvingCandidateId.value = candidate.id
  error.value = ''
  try {
    clarification.value = await api.resolveMaterialCandidate(projectId.value, {
      candidate_id: candidate.id,
      action,
      value,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '材料候选处理失败'
  } finally {
    resolvingCandidateId.value = ''
  }
}

function valueOf(value: unknown) {
  return typeof value === 'string' && value ? value : '待确认'
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function fileSize(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function messageAttachments(message: ConversationTurn) {
  const source = message.source_refs?.find((item) => Array.isArray(item.attachments))
  return Array.isArray(source?.attachments)
    ? source.attachments.filter(
        (item): item is { name: string; fileSize?: number } =>
          Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).name === 'string'),
      )
    : []
}

function messageQuestion(message: ConversationTurn) {
  const source = message.source_refs?.find(
    (item) => typeof item.questionText === 'string' && item.questionText.trim(),
  )
  return typeof source?.questionText === 'string' ? source.questionText : ''
}

function onAttachmentChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  const merged = [...selectedAttachments.value, ...files]
  if (merged.length > 5) {
    attachmentError.value = '一次最多附加 5 个文件。'
  }
  selectedAttachments.value = merged.slice(0, 5)
}

function removeAttachment(index: number) {
  selectedAttachments.value = selectedAttachments.value.filter((_, itemIndex) => itemIndex !== index)
  if (!selectedAttachments.value.length) attachmentError.value = ''
}

async function uploadAttachments(files: File[]): Promise<SourceFile[]> {
  const uploaded: SourceFile[] = []
  for (const [index, file] of files.entries()) {
    streamStatus.value = `正在上传附件（${index + 1}/${files.length}）…`
    uploaded.push(await api.uploadProjectFile(projectId.value, file))
  }
  return uploaded
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    clarification.value = await api.clarification(projectId.value)
    await scrollToNewest()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '澄清会话读取失败'
  } finally {
    loading.value = false
  }
}

async function send(
  content = answer.value,
  inputMode: 'manual' | 'suggestion' | 'confirm' = 'manual',
) {
  const filesToUpload = [...selectedAttachments.value]
  const value = content.trim() || (filesToUpload.length ? '我补充了附件，请结合附件继续判断。' : '')
  if (!value || sending.value || !canReply.value) return
  const current = clarification.value
  answeringQuestion.value = current?.next.content ?? ''
  attachmentError.value = ''
  const optimisticMessage: ConversationTurn = {
    id: `pending-${Date.now()}`,
    project_id: projectId.value,
    role: 'user',
    content: value,
    source_type: inputMode === 'suggestion' ? 'suggested_answer' : inputMode === 'confirm' ? 'confirmation' : 'chat',
    source_refs: [{
      inputMode,
      questionKey: current?.next.questionKey ?? null,
      attachments: filesToUpload.map((file) => ({ name: file.name, fileSize: file.size })),
    }],
    created_at: new Date().toISOString(),
  }
  if (current) {
    clarification.value = {
      ...current,
      messages: [...current.messages, optimisticMessage],
    }
  }
  sending.value = true
  error.value = ''
  answer.value = ''
  streamStatus.value = '已收到回答，AI 正在分析…'
  streamingAssistant.value = ''
  await scrollToNewest()
  try {
    uploadingAttachments.value = filesToUpload.length > 0
    const uploadedFiles = filesToUpload.length ? await uploadAttachments(filesToUpload) : []
    uploadingAttachments.value = false
    selectedAttachments.value = []
    clarification.value = await api.sendClarificationMessageStream(
      projectId.value,
      value,
      {
        inputMode,
        questionKey: current?.next.questionKey ?? null,
        attachmentIds: uploadedFiles.map((file) => file.id),
      },
      (event: ClarificationStreamEvent) => {
        if (event.type === 'status') {
          streamStatus.value = event.message
        } else if (event.type === 'assistant_delta') {
          streamingAssistant.value += event.content
        } else if (event.type === 'assistant_reset') {
          streamingAssistant.value = event.content
        }
        void scrollToNewest()
      },
    )
    await scrollToNewest()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '提交回答失败'
    answer.value = value
    attachmentError.value = filesToUpload.length ? '附件已上传或发送失败，请检查材料列表后重试。' : ''
    try {
      clarification.value = await api.clarification(projectId.value)
      await scrollToNewest()
    } catch {
      // Keep the immediate local reply visible when the recovery request also fails.
    }
  } finally {
    sending.value = false
    uploadingAttachments.value = false
    streamStatus.value = ''
    streamingAssistant.value = ''
    answeringQuestion.value = ''
  }
}

async function scrollToNewest() {
  await nextTick()
  if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight
}

onMounted(load)
watch(projectId, load)
</script>

<template>
  <div class="clarify-page">
    <div class="page-head">
      <div>
        <div class="page-kicker">Clarification / AI 澄清</div>
        <h1>让 AI 判断还缺什么</h1>
        <p class="sub">AI 会结合上下文只追问影响方案的关键问题；字段清单只用于后台校验，不会按 SOP 顺序逐项盘问。</p>
      </div>
      <RouterLink class="btn" :to="`/projects/${projectId}`">
        <ArrowLeft :size="15" aria-hidden="true" />
        <span>返回需求</span>
      </RouterLink>
    </div>

    <p v-if="error" class="banner warn">{{ error }}</p>
    <div v-if="loading" class="card empty">正在准备澄清会话…</div>

    <div v-else-if="clarification" class="clarify-layout">
      <section class="card clarify-chat">
        <div class="clarify-chat-head">
          <div>
            <div class="section-label">Conversation / 对话</div>
            <strong>{{ chatTitle }}</strong>
          </div>
          <div class="clarify-chat-head-meta">
            <span class="chat-save-hint">对话自动保存</span>
            <span class="badge" :class="clarification.projectStatus === 'needs_info' ? 'warn' : clarification.projectStatus === 'waiting_review' ? 'ok' : 'muted'">
              {{ clarification.projectStatus === 'needs_info' ? '需要补充' : clarification.projectStatus === 'waiting_review' ? '等待评审' : '澄清中' }}
            </span>
          </div>
        </div>

        <div ref="transcript" class="transcript" aria-live="polite" :aria-busy="sending">
          <article
            v-for="message in clarification.messages"
            :key="message.id"
            class="message"
            :class="message.role === 'user' ? 'from-user' : 'from-ai'"
          >
            <div class="message-role">
              <Sparkles v-if="message.role !== 'user'" :size="13" aria-hidden="true" />
              {{ message.role === 'user' ? '你' : message.source_type.startsWith('review') ? '评审反馈' : 'AI 需求分析师' }}
            </div>
            <div v-if="message.role === 'user' && messageQuestion(message)" class="message-question">
              <span>回答的问题</span>
              <p>{{ messageQuestion(message) }}</p>
            </div>
            <p>{{ message.content }}</p>
            <div v-if="messageAttachments(message).length" class="message-attachments">
              <span v-for="attachment in messageAttachments(message)" :key="attachment.name">
                <Paperclip :size="12" aria-hidden="true" />
                {{ attachment.name }}
              </span>
            </div>
            <time>{{ formatTime(message.created_at) }}</time>
          </article>
          <article v-if="sending" class="message from-ai thinking-message" aria-label="AI 正在思考">
            <div class="message-role">
              <Sparkles :size="13" class="thinking-icon" aria-hidden="true" />
              AI 需求分析师
            </div>
            <p v-if="streamingAssistant" class="streaming-copy">
              {{ streamingAssistant }}<span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            </p>
            <p v-else>{{ streamStatus || 'AI 正在思考' }}<span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>
          </article>
        </div>

        <div v-if="canReply" class="chat-composer">
          <div v-if="currentQuestion" class="current-question">
            <div class="current-question-label">当前问题</div>
            <p>{{ currentQuestion }}</p>
          </div>
          <div v-if="isConfirming" class="confirm-panel">
            <div class="confirm-panel-copy">
              <CheckCircle2 :size="18" aria-hidden="true" />
              <div>
                <strong>AI 已判断信息足够形成方案</strong>
                <p>确认画像后，需求会提交评审；如果还要补充事实，也可以继续输入。</p>
              </div>
            </div>
            <button class="btn btn-primary" type="button" :disabled="sending" @click="send('确认需求画像', 'confirm')">
              <CheckCircle2 :size="15" aria-hidden="true" />
              <span>{{ sending ? '提交中…' : '确认并提交评审' }}</span>
            </button>
          </div>
          <div v-if="replyChips.length" class="reply-chips" aria-label="建议回答">
            <button
              v-for="chip in replyChips"
              :key="chip"
              class="reply-chip"
              type="button"
              :disabled="sending"
              @click="send(chip, 'suggestion')"
            >
              {{ chip }}
            </button>
          </div>
          <div v-if="selectedAttachments.length" class="selected-attachments">
            <div v-for="(file, index) in selectedAttachments" :key="`${file.name}-${file.lastModified}-${index}`" class="selected-attachment">
              <Paperclip :size="13" aria-hidden="true" />
              <span>{{ file.name }} · {{ fileSize(file.size) }}</span>
              <button type="button" title="移除附件" :aria-label="`移除 ${file.name}`" :disabled="sending" @click="removeAttachment(index)">
                <X :size="13" aria-hidden="true" />
              </button>
            </div>
          </div>
          <p v-if="attachmentError" class="attachment-error">{{ attachmentError }}</p>
          <form class="chat-form" @submit.prevent="send()">
            <textarea
              v-model="answer"
              :disabled="sending"
              rows="3"
              placeholder="输入你的回答，也可以附加业务材料"
            />
            <label class="chat-attach" title="附加业务材料" aria-label="附加业务材料">
              <Paperclip :size="17" aria-hidden="true" />
              <input
                type="file"
                multiple
                accept=".docx,.pdf,.txt,.md,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.gif,.bmp"
                :disabled="sending"
                @change="onAttachmentChange"
              />
            </label>
            <button class="btn btn-primary chat-send" type="submit" :disabled="!canSend" aria-label="发送回答">
              <Send :size="16" aria-hidden="true" />
            </button>
          </form>
          <p class="chat-attachment-hint">
            {{ uploadingAttachments ? '附件上传中…' : '支持 Word、PDF、Excel、CSV、TXT、MD 和图片，发送时会一起交给 AI。' }}
          </p>
        </div>
        <div v-else class="chat-locked">
          需求已提交评审。评审人退回补充信息时，会在这里出现新的问题。
        </div>
      </section>

      <aside class="clarify-side">
        <section v-if="materialCandidates.length" class="card card-pad gap-card">
          <div class="section-label">Material review / 材料提取确认</div>
          <div class="card-title mt8">确认后才写入正式画像</div>
          <p class="card-sub">材料内容可能过期或互相冲突。请接受、修改或驳回每条候选信息。</p>
          <div class="gap-list mt16">
            <div v-for="candidate in materialCandidates" :key="candidate.id" class="gap-item">
              <div class="flex-between gap8">
                <strong>{{ candidateFieldLabels[candidate.field] ?? candidate.field }}</strong>
                <span class="badge" :class="candidate.status === 'conflict' ? 'warn' : 'muted'">
                  {{ candidate.status === 'conflict' ? '来源冲突' : '待确认' }}
                </span>
              </div>
              <span>{{ candidateValue(candidate) }}</span>
              <small>{{ candidate.source }} · {{ candidate.locator }}</small>
              <div class="flex gap8 mt8">
                <button class="btn btn-primary" type="button" :disabled="Boolean(resolvingCandidateId)" @click="resolveCandidate(candidate, 'accept')">接受</button>
                <button class="btn secondary" type="button" :disabled="Boolean(resolvingCandidateId)" @click="resolveCandidate(candidate, 'edit')">修改后接受</button>
                <button class="btn ghost" type="button" :disabled="Boolean(resolvingCandidateId)" @click="resolveCandidate(candidate, 'reject')">驳回</button>
              </div>
            </div>
          </div>
        </section>

        <section class="card card-pad business-context-card">
          <div class="section-label">Business context / 业务上下文</div>
          <div class="card-title mt8">已确认业务事实</div>
          <dl class="profile-facts context-facts">
            <div>
              <dt>已确认业务链路</dt>
              <dd>{{ businessChain }}</dd>
            </div>
            <div v-for="[label, value] in confirmedBusinessFacts" :key="label">
              <dt>{{ label }}</dt>
              <dd>{{ value }}</dd>
            </div>
          </dl>
          <p v-if="!confirmedBusinessFacts.length" class="card-sub mt8">先确认业务链路，AI 才会按对应场景继续追问。</p>
          <div v-if="initialInference || businessContext?.candidateSignals?.length" class="context-signals">
            <p v-if="initialInference">AI 初步猜测：{{ initialInference }}（待你确认）</p>
            <div v-if="businessContext?.candidateSignals?.length" class="signal-list">
              <span v-for="signal in businessContext.candidateSignals" :key="signal">{{ signal }}</span>
            </div>
          </div>
        </section>

        <section class="card card-pad profile-card">
          <div class="section-label">Live profile / 实时画像</div>
          <div class="card-title mt8">{{ profileTitle }}</div>
          <div class="profile-progress">
            <span>信息覆盖 {{ clarification.profile.completeness }}%</span>
            <div><i :style="{ width: `${clarification.profile.completeness}%` }"></i></div>
          </div>
          <dl class="profile-facts">
            <div v-for="[label, value] in profileFacts" :key="label">
              <dt>{{ label }}</dt>
              <dd>{{ value }}</dd>
            </div>
          </dl>
          <div v-if="clarification.profile.sourceEvidence?.length" class="context-signals mt16">
            <p>材料来源定位</p>
            <div class="gap-list mt8">
              <div
                v-for="(evidence, index) in clarification.profile.sourceEvidence.slice(0, 8)"
                :key="`${evidence.field}-${evidence.source}-${evidence.locator}-${index}`"
                class="gap-item"
              >
                <strong>{{ evidence.source }} · {{ evidence.locator }}</strong>
                <span>{{ evidence.excerpt }}</span>
              </div>
            </div>
          </div>
        </section>

        <section class="card card-pad gap-card">
          <div class="section-label">Open gaps / 待确认</div>
          <div class="card-title mt8">AI 当前关注的关键缺口</div>
          <div v-if="clarification.gaps.length" class="gap-list">
            <div v-for="gap in clarification.gaps" :key="gap.key" class="gap-item">
              <strong>{{ gap.label }}</strong>
              <span>{{ gap.reason }}</span>
            </div>
          </div>
          <p v-else class="card-sub">关键字段已齐全，确认画像后进入评审。</p>
        </section>
      </aside>
    </div>
  </div>
</template>
