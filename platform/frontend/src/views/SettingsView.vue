<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Database,
  FileText,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  ServerCog,
  Settings2,
  Sparkles,
  Upload,
} from 'lucide-vue-next'
import { api } from '../api/client'
import type {
  KnowledgeFile,
  LlmPreset,
  LlmProfile,
  LlmStatus,
  PublicSettings,
  RagflowStatus,
  ReadyResponse,
} from '../api/types'
import StatusBadge from '../components/StatusBadge.vue'

const loading = ref(true)
const error = ref('')
const settings = ref<PublicSettings | null>(null)
const ready = ref<ReadyResponse | null>(null)
const llm = ref<LlmStatus | null>(null)
const ragflow = ref<RagflowStatus | null>(null)
const knowledgeFiles = ref<KnowledgeFile[]>([])
const knowledgeFilesLoading = ref(false)
const knowledgeUploading = ref(false)
const knowledgeError = ref('')
const testingModel = ref<'default' | 'quality' | null>(null)
const testResult = ref('')
const testError = ref('')
const savingLlm = ref(false)
const saveLlmResult = ref('')
const saveLlmError = ref('')
const switchLlmError = ref('')
const switchingProfile = ref(false)
const selectedProfileId = ref('')
const editingProfileId = ref<string | null>(null)
const advancedOpen = ref(false)
const selectedPresetId = ref('custom')
const llmPresets = computed(() => llm.value?.presets ?? [])
const llmProfiles = computed(() => llm.value?.profiles ?? [])
const activeProfile = computed(() =>
  llmProfiles.value.find((profile) => profile.active) ?? llmProfiles.value[0],
)
const selectedPreset = computed(() =>
  llmPresets.value.find((preset) => preset.id === selectedPresetId.value),
)
const llmForm = reactive({
  profileName: '',
  provider: '',
  baseUrl: '',
  model: '',
  qualityModel: '',
  apiKey: '',
  clearApiKey: false,
  timeoutSeconds: 30,
  documentTimeoutSeconds: 90,
})

function flag(value: boolean | undefined) {
  if (value === undefined) return { tone: 'muted' as const, label: '未知' }
  return value ? { tone: 'ok' as const, label: '已配置' } : { tone: 'warn' as const, label: '未配置' }
}

function presetForCurrentConfig(presets: LlmPreset[]) {
  return presets.find((preset) =>
    preset.id === llmForm.provider ||
    (preset.baseUrl === llmForm.baseUrl && preset.model === llmForm.model),
  )
}

function profileForCurrentConfig(profiles: LlmProfile[]) {
  return profiles.find((profile) => profile.active)
}

function applyLlmStatus(value: LlmStatus) {
  const normalizedLlm = {
    ...value,
    presets: value.presets ?? [],
    profiles: value.profiles ?? [],
  }
  llm.value = normalizedLlm
  const currentProfile = profileForCurrentConfig(normalizedLlm.profiles)
  selectedProfileId.value = currentProfile?.id || ''
  editingProfileId.value = currentProfile?.id || null
  llmForm.profileName = currentProfile?.name || `${normalizedLlm.provider} / ${normalizedLlm.model}`
  llmForm.provider = normalizedLlm.provider
  llmForm.baseUrl = normalizedLlm.baseUrl
  llmForm.model = normalizedLlm.model
  llmForm.qualityModel = normalizedLlm.qualityModel
  llmForm.timeoutSeconds = normalizedLlm.timeoutSeconds
  llmForm.documentTimeoutSeconds = normalizedLlm.documentTimeoutSeconds
  selectedPresetId.value = presetForCurrentConfig(normalizedLlm.presets)?.id || 'custom'
  llmForm.apiKey = ''
  llmForm.clearApiKey = false
}

function applyPreset() {
  const preset = selectedPreset.value
  if (!preset) return
  llmForm.provider = preset.id
  llmForm.baseUrl = preset.baseUrl
  llmForm.model = preset.model
  llmForm.qualityModel = preset.qualityModel
  if (!editingProfileId.value) llmForm.profileName = preset.label
}

function startNewProfile() {
  editingProfileId.value = null
  selectedPresetId.value = 'custom'
  llmForm.profileName = ''
  llmForm.provider = ''
  llmForm.baseUrl = ''
  llmForm.model = ''
  llmForm.qualityModel = ''
  llmForm.apiKey = ''
  llmForm.clearApiKey = false
  advancedOpen.value = true
}

async function switchProfile() {
  if (!selectedProfileId.value || selectedProfileId.value === activeProfile.value?.id) return
  switchingProfile.value = true
  switchLlmError.value = ''
  try {
    applyLlmStatus(await api.activateLlmProfile(selectedProfileId.value))
  } catch (err) {
    switchLlmError.value = err instanceof Error ? err.message : '模型切换失败'
    selectedProfileId.value = activeProfile.value?.id || ''
  } finally {
    switchingProfile.value = false
  }
}

async function load() {
  loading.value = true
  knowledgeFilesLoading.value = true
  error.value = ''
  knowledgeError.value = ''
  const knowledgeRequest = api.knowledgeFiles()
    .then((knowledgeFilesValue) => {
      knowledgeFiles.value = knowledgeFilesValue.items
    })
    .catch((err) => {
      knowledgeError.value = err instanceof Error ? err.message : '知识资料读取失败'
    })
    .finally(() => {
      knowledgeFilesLoading.value = false
    })

  try {
    const [settingsValue, readyValue, llmValue, ragflowValue] = await Promise.all([
      api.publicSettings(),
      api.ready(),
      api.llmStatus(),
      api.ragflowStatus(),
    ])
    settings.value = settingsValue
    ready.value = readyValue
    applyLlmStatus(llmValue)
    ragflow.value = ragflowValue
  } catch (err) {
    error.value = err instanceof Error ? err.message : '设置读取失败'
  } finally {
    loading.value = false
  }
  await knowledgeRequest
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

async function onKnowledgeFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  knowledgeUploading.value = true
  knowledgeError.value = ''
  try {
    const uploaded = await api.uploadKnowledgeFile(file)
    knowledgeFiles.value = [uploaded, ...knowledgeFiles.value]
  } catch (err) {
    knowledgeError.value = err instanceof Error ? err.message : '知识资料上传失败'
  } finally {
    knowledgeUploading.value = false
  }
}

async function testLlm(mode: 'default' | 'quality') {
  testingModel.value = mode
  testResult.value = ''
  testError.value = ''
  try {
    const result = await api.testLlm(mode)
    testResult.value = `${result.model} 连接成功，耗时 ${result.latencyMs} ms。模型回复：${result.reply}`
  } catch (err) {
    testError.value = err instanceof Error ? err.message : 'LLM 连接测试失败'
  } finally {
    testingModel.value = null
  }
}

async function saveLlmProfile() {
  savingLlm.value = true
  saveLlmResult.value = ''
  saveLlmError.value = ''
  try {
    const savedLlm = await api.saveLlmProfile({
      profile_id: editingProfileId.value || undefined,
      profile_name: llmForm.profileName.trim(),
      provider: llmForm.provider.trim(),
      base_url: llmForm.baseUrl.trim(),
      model: llmForm.model.trim(),
      quality_model: llmForm.qualityModel.trim(),
      api_key: llmForm.apiKey.trim() || undefined,
      clear_api_key: llmForm.clearApiKey,
      timeout_seconds: Number(llmForm.timeoutSeconds),
      document_timeout_seconds: Number(llmForm.documentTimeoutSeconds),
    })
    applyLlmStatus(savedLlm)
    saveLlmResult.value = '模型档案已保存并启用。'
  } catch (err) {
    saveLlmError.value = err instanceof Error ? err.message : '模型配置保存失败'
  } finally {
    savingLlm.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="page-kicker">Configuration / 设置</div>
        <h1>设置</h1>
        <p class="sub">评审人可以切换模型服务和中转站。密钥只提交到后端，不会回显到浏览器。</p>
      </div>
      <button class="btn" type="button" :disabled="loading" @click="load">
        <RefreshCw :size="15" :class="{ 'is-spinning': loading }" aria-hidden="true" />
        <span>刷新</span>
      </button>
    </div>

    <p v-if="error" class="banner warn">{{ error }}</p>

    <section class="settings-summary">
      <div>
        <div class="section-label">Guardrails / 系统边界</div>
        <h2>让模型更聪明，也让系统保持可控。</h2>
        <p>模型负责理解与补充，后端负责密钥、数据库和运行边界。即使外部服务暂时不可用，前置分析仍可回退到规则引擎。</p>
      </div>
      <div class="settings-summary-mark" aria-hidden="true"><ServerCog :size="25" /></div>
    </section>

    <div class="grid grid-2">
      <section class="card card-pad">
        <div class="section-label">Runtime / 运行时</div>
        <div class="card-title mt8"><ServerCog :size="17" aria-hidden="true" />运行状态</div>
        <dl class="kv">
          <div>
            <dt>应用</dt>
            <dd>{{ settings?.app.name || '—' }} {{ settings?.app.version ? `v${settings.app.version}` : '' }}</dd>
          </div>
          <div>
            <dt>环境</dt>
            <dd>{{ settings?.app.environment || '—' }} / {{ settings?.app.runtimeMode || '—' }}</dd>
          </div>
          <div>
            <dt>MySQL</dt>
            <dd>
              <StatusBadge
                :tone="ready?.database.ready ? 'ok' : 'off'"
                :label="ready?.database.ready ? '已就绪' : '未就绪'"
              />
              <span class="muted"> {{ settings?.database.host }}:{{ settings?.database.port }}/{{ settings?.database.name }}</span>
            </dd>
          </div>
          <div>
            <dt>数据库用户</dt>
            <dd>{{ settings?.database.user || '—' }}</dd>
          </div>
        </dl>
      </section>

      <section class="card card-pad">
        <div class="section-label">Security / 安全</div>
        <div class="card-title mt8"><KeyRound :size="17" aria-hidden="true" />密钥边界</div>
        <p class="card-sub">需求人看不到模型配置；评审人只能看到 API Key 是否已配置。</p>
        <ul class="placeholder-list">
          <li>LLM Key 通过加密方式保存在后端配置表，不保存明文。</li>
          <li>Embedding / Rerank / RAGFlow 的 Key 仍只从后端环境变量读取。</li>
          <li>未配置 LLM Key 时，后续业务仍可回退到规则引擎。</li>
        </ul>
      </section>

      <section class="card card-pad">
        <div class="section-label">Intelligence / 智能层</div>
        <div class="card-title mt8"><Sparkles :size="17" aria-hidden="true" />LLM 策略</div>
        <dl class="kv">
          <div>
            <dt>Provider</dt>
            <dd>{{ llm?.provider || settings?.llm.provider || '—' }}</dd>
          </div>
          <div>
            <dt>Base URL</dt>
            <dd class="break">{{ llm?.baseUrl || settings?.llm.baseUrl || '—' }}</dd>
          </div>
          <div>
            <dt>默认模型</dt>
            <dd>{{ llm?.model || settings?.llm.model || '—' }}</dd>
          </div>
          <div>
            <dt>高质量模型</dt>
            <dd>{{ llm?.qualityModel || settings?.llm.qualityModel || '—' }}</dd>
          </div>
          <div>
            <dt>文档生成超时</dt>
            <dd>{{ settings?.llm.documentTimeoutSeconds || '—' }} 秒</dd>
          </div>
          <div>
            <dt>API Key</dt>
            <dd><StatusBadge v-bind="flag(llm?.apiKeyConfigured ?? settings?.llm.apiKeyConfigured)" /></dd>
          </div>
        </dl>
        <div class="form llm-config-form mt16">
          <label>
            已配置模型
            <select v-model="selectedProfileId" :disabled="switchingProfile || !llmProfiles.length" @change="switchProfile">
              <option v-if="!llmProfiles.length" value="">暂无已配置模型</option>
              <option v-for="profile in llmProfiles" :key="profile.id" :value="profile.id">
                {{ profile.name }} · {{ profile.model }}
              </option>
            </select>
          </label>
          <p class="card-sub">
            这里只显示已经保存的模型配置。切换已配置模型不会要求重新输入 API Key。
          </p>
          <p v-if="switchingProfile" class="banner info">正在切换模型…</p>
          <p v-if="switchLlmError" class="banner warn">{{ switchLlmError }}</p>
          <div class="actions">
            <button class="btn" type="button" @click="advancedOpen = !advancedOpen">
              <Settings2 :size="15" aria-hidden="true" />
              <span>{{ advancedOpen ? '收起高级设置' : '打开高级设置' }}</span>
            </button>
            <button class="btn btn-primary" type="button" @click="startNewProfile">
              <Plus :size="15" aria-hidden="true" />
              <span>新增模型</span>
            </button>
          </div>
        </div>
        <p v-if="saveLlmResult" class="banner info mt16">{{ saveLlmResult }}</p>
        <p v-if="saveLlmError" class="banner warn mt16">{{ saveLlmError }}</p>
        <div v-if="advancedOpen" class="advanced-settings mt16">
          <div class="section-label"><Settings2 :size="15" aria-hidden="true" />高级设置</div>
          <form class="form advanced-settings-form mt16" @submit.prevent="saveLlmProfile">
            <label>
              配置名称
              <input v-model="llmForm.profileName" type="text" maxlength="120" placeholder="例如：DeepSeek 主模型" required />
            </label>
            <label>
              常用模型厂商
              <select v-model="selectedPresetId" @change="applyPreset">
                <option value="custom">自定义兼容接口</option>
                <option v-for="preset in llmPresets" :key="preset.id" :value="preset.id">
                  {{ preset.label }}
                </option>
              </select>
            </label>
            <p v-if="selectedPresetId !== 'custom'" class="preset-hint">
              {{ selectedPreset?.description }}
              <a
                v-if="selectedPreset?.docsUrl"
                :href="selectedPreset.docsUrl"
                target="_blank"
                rel="noreferrer"
              >查看接口文档</a>
            </p>
            <div class="form-grid-2">
              <label>
                Provider
                <input v-model="llmForm.provider" type="text" maxlength="120" placeholder="例如 openai-relay" required />
              </label>
              <label>
                Base URL
                <input v-model="llmForm.baseUrl" type="url" maxlength="500" placeholder="https://中转站/v1" required />
              </label>
            </div>
            <div class="form-grid-2">
              <label>
                默认模型
                <input v-model="llmForm.model" type="text" maxlength="180" placeholder="例如 gpt-4.1-mini" required />
              </label>
              <label>
                高质量模型
                <input v-model="llmForm.qualityModel" type="text" maxlength="180" placeholder="例如 gpt-4.1" required />
              </label>
            </div>
            <label>
              API Key
              <input
                v-model="llmForm.apiKey"
                type="password"
                autocomplete="new-password"
                placeholder="留空表示保持当前档案密钥"
              />
            </label>
            <div class="form-grid-2">
              <label>
                普通请求超时（秒）
                <input v-model.number="llmForm.timeoutSeconds" type="number" min="5" max="300" required />
              </label>
              <label>
                文档生成超时（秒）
                <input v-model.number="llmForm.documentTimeoutSeconds" type="number" min="15" max="1800" required />
              </label>
            </div>
            <label class="check-row">
              <input v-model="llmForm.clearApiKey" type="checkbox" />
              清除当前档案的 API Key
            </label>
            <button class="btn btn-primary" type="submit" :disabled="savingLlm || loading">
              <Save :size="15" aria-hidden="true" />
              <span>{{ savingLlm ? '保存中…' : '保存并启用档案' }}</span>
            </button>
          </form>
          <p class="card-sub mt16">API Key 不会回显；完整配置只在高级设置中编辑。</p>
          <div class="actions mt16">
            <button
              class="btn"
              type="button"
              :disabled="testingModel !== null"
              @click="testLlm('default')"
            >
              {{ testingModel === 'default' ? '测试中…' : '测试默认模型' }}
            </button>
            <button
              class="btn"
              type="button"
              :disabled="testingModel !== null"
              @click="testLlm('quality')"
            >
              {{ testingModel === 'quality' ? '测试中…' : '测试高质量模型' }}
            </button>
          </div>
          <p v-if="testResult" class="banner info mt16">{{ testResult }}</p>
          <p v-if="testError" class="banner warn mt16">{{ testError }}</p>
        </div>
      </section>

      <section class="card card-pad">
        <div class="section-label">Knowledge / 知识层</div>
        <div class="card-title mt8"><Database :size="17" aria-hidden="true" />RAGFlow</div>
        <p class="card-sub">RAGFlow 暂缓到下一版；当前方案使用评审人上传的本地知识资料。</p>
        <dl class="kv">
          <div>
            <dt>启用</dt>
            <dd>
              <StatusBadge
                :tone="ragflow?.enabled ? 'warn' : 'muted'"
                :label="ragflow?.enabled ? '已配置（下一版接入）' : '暂缓接入'"
              />
            </dd>
          </div>
          <div>
            <dt>Base URL</dt>
            <dd class="break">{{ ragflow?.baseUrl || settings?.ragflow.baseUrl || '—' }}</dd>
          </div>
          <div>
            <dt>API Key</dt>
            <dd><StatusBadge v-bind="flag(ragflow?.apiKeyConfigured ?? settings?.ragflow.apiKeyConfigured)" /></dd>
          </div>
          <div>
            <dt>超时</dt>
            <dd>{{ ragflow?.timeoutSeconds ?? '—' }} 秒</dd>
          </div>
        </dl>
      </section>

      <section class="card card-pad">
        <div class="card-title">Embedding / Rerank</div>
        <dl class="kv">
          <div>
            <dt>Embedding</dt>
            <dd>{{ settings?.embedding.provider }} / {{ settings?.embedding.model }}</dd>
          </div>
          <div>
            <dt>Embedding Key</dt>
            <dd><StatusBadge v-bind="flag(settings?.embedding.apiKeyConfigured)" /></dd>
          </div>
          <div>
            <dt>Rerank</dt>
            <dd>{{ settings?.rerank.provider }} / {{ settings?.rerank.model }}</dd>
          </div>
          <div>
            <dt>Rerank Key</dt>
            <dd><StatusBadge v-bind="flag(settings?.rerank.apiKeyConfigured)" /></dd>
          </div>
        </dl>
      </section>

      <section class="card card-pad">
        <div class="card-title">本地知识库兜底</div>
        <dl class="kv">
          <div>
            <dt>目录</dt>
            <dd class="break">{{ settings?.knowledge.localPath || '—' }}</dd>
          </div>
          <div>
            <dt>阈值 / 条数</dt>
            <dd>{{ settings?.knowledge.similarityThreshold }} / {{ settings?.knowledge.pageSize }}</dd>
          </div>
        </dl>
      </section>

      <section class="card card-pad knowledge-upload-card">
        <div class="flex-between">
          <div>
            <div class="section-label">Reviewer knowledge / 评审人知识资料</div>
            <div class="card-title mt8"><FileText :size="17" aria-hidden="true" />上传七邦业务资料</div>
            <p class="card-sub">第一版直接使用本地资料检索。支持 Word、PDF、Excel、CSV、TXT、MD；图片可上传保存，待后续视觉识别后参与检索。</p>
          </div>
          <label class="btn file-button">
            <Upload v-if="!knowledgeUploading" :size="15" aria-hidden="true" />
            {{ knowledgeUploading ? '上传中…' : '上传资料' }}
            <input
              type="file"
              accept=".docx,.pdf,.txt,.md,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.gif,.bmp"
              :disabled="knowledgeUploading"
              @change="onKnowledgeFileChange"
            />
          </label>
        </div>

        <p v-if="knowledgeError" class="banner warn mt16">{{ knowledgeError }}</p>
        <div v-if="knowledgeFilesLoading" class="empty">正在读取知识资料…</div>
        <div v-else-if="!knowledgeFiles.length" class="empty knowledge-empty">
          <FileText :size="19" aria-hidden="true" />
          还没有评审人上传的知识资料。
        </div>
        <div v-else class="knowledge-file-list mt16">
          <article v-for="item in knowledgeFiles" :key="item.id" class="knowledge-file-item">
            <div class="flex-between">
              <div>
                <div class="req-title">{{ item.original_filename }}</div>
                <div class="req-meta">
                  {{ item.parser_type?.toUpperCase() || '未知类型' }} · {{ fileSize(item.file_size) }} ·
                  {{ item.text_length }} 字
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
    </div>
  </div>
</template>
