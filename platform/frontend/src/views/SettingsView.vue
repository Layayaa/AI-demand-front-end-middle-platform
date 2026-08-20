<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api/client'
import type { LlmStatus, PublicSettings, RagflowStatus, ReadyResponse } from '../api/types'

const loading = ref(true)
const error = ref('')
const settings = ref<PublicSettings | null>(null)
const ready = ref<ReadyResponse | null>(null)
const llm = ref<LlmStatus | null>(null)
const ragflow = ref<RagflowStatus | null>(null)

function keyLabel(configured: boolean | undefined) {
  if (configured === undefined) return '—'
  return configured ? '已配置' : '未配置'
}

function keyClass(configured: boolean | undefined) {
  if (configured === undefined) return ''
  return configured ? 'v-ok' : 'v-warn'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [settingsValue, readyValue, llmValue, ragflowValue] = await Promise.all([
      api.publicSettings(),
      api.ready(),
      api.llmStatus(),
      api.ragflowStatus(),
    ])
    settings.value = settingsValue
    ready.value = readyValue
    llm.value = llmValue
    ragflow.value = ragflowValue
  } catch (err) {
    error.value = err instanceof Error ? err.message : '设置读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="kicker">Settings</div>
    <div class="headline">
      <h1>设置</h1>
      <button class="btn" type="button" :disabled="loading" @click="load">刷新</button>
    </div>

    <p v-if="error" class="note">{{ error }}</p>

    <div v-else class="sheet">
      <section class="block">
        <h2>运行</h2>
        <dl class="rows">
          <div class="row">
            <dt>应用</dt>
            <dd>{{ settings?.app.name }} {{ settings?.app.version }}</dd>
          </div>
          <div class="row">
            <dt>环境</dt>
            <dd>{{ settings?.app.environment }} · {{ settings?.app.runtimeMode }}</dd>
          </div>
          <div class="row">
            <dt>数据库</dt>
            <dd>
              {{ settings?.database.host }}:{{ settings?.database.port }} / {{ settings?.database.name }}
              <span :class="ready?.database.ready ? 'v-ok' : 'v-bad'">
                {{ ready?.database.ready ? ' 已连接' : ' 未连接' }}
              </span>
            </dd>
          </div>
          <div class="row">
            <dt>用户</dt>
            <dd>{{ settings?.database.user || '—' }}</dd>
          </div>
        </dl>
      </section>

      <section class="block">
        <h2>语言模型</h2>
        <dl class="rows">
          <div class="row">
            <dt>提供方</dt>
            <dd>{{ llm?.provider || settings?.llm.provider }}</dd>
          </div>
          <div class="row">
            <dt>接口</dt>
            <dd>{{ llm?.baseUrl || settings?.llm.baseUrl }}</dd>
          </div>
          <div class="row">
            <dt>模型</dt>
            <dd>{{ llm?.model || settings?.llm.model }}</dd>
          </div>
          <div class="row">
            <dt>密钥</dt>
            <dd :class="keyClass(llm?.apiKeyConfigured ?? settings?.llm.apiKeyConfigured)">
              {{ keyLabel(llm?.apiKeyConfigured ?? settings?.llm.apiKeyConfigured) }}
            </dd>
          </div>
        </dl>
      </section>

      <section class="block">
        <h2>检索</h2>
        <dl class="rows">
          <div class="row">
            <dt>RAGFlow</dt>
            <dd>{{ ragflow?.enabled || settings?.ragflow.enabled ? '启用' : '关闭' }}</dd>
          </div>
          <div class="row">
            <dt>接口</dt>
            <dd>{{ ragflow?.baseUrl || settings?.ragflow.baseUrl }}</dd>
          </div>
          <div class="row">
            <dt>密钥</dt>
            <dd :class="keyClass(ragflow?.apiKeyConfigured ?? settings?.ragflow.apiKeyConfigured)">
              {{ keyLabel(ragflow?.apiKeyConfigured ?? settings?.ragflow.apiKeyConfigured) }}
            </dd>
          </div>
        </dl>
      </section>

      <section class="block">
        <h2>向量</h2>
        <dl class="rows">
          <div class="row">
            <dt>Embedding</dt>
            <dd>{{ settings?.embedding.provider }} / {{ settings?.embedding.model }}</dd>
          </div>
          <div class="row">
            <dt>密钥</dt>
            <dd :class="keyClass(settings?.embedding.apiKeyConfigured)">
              {{ keyLabel(settings?.embedding.apiKeyConfigured) }}
            </dd>
          </div>
          <div class="row">
            <dt>Rerank</dt>
            <dd>{{ settings?.rerank.provider }} / {{ settings?.rerank.model }}</dd>
          </div>
          <div class="row">
            <dt>密钥</dt>
            <dd :class="keyClass(settings?.rerank.apiKeyConfigured)">
              {{ keyLabel(settings?.rerank.apiKeyConfigured) }}
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <p class="hint">密钥只存在服务端，这里只显示是否已配置。</p>
  </div>
</template>
