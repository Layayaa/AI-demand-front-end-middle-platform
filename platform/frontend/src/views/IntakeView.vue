<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, FilePlus2 } from 'lucide-vue-next'
import { api } from '../api/client'

const router = useRouter()
const saving = ref(false)
const error = ref('')
const form = reactive({
  title: '',
  department: '',
  summary: '',
  requirementType: '',
})

async function onSubmit() {
  const title = form.title.trim()
  if (!title) {
    error.value = '请填写需求标题。'
    return
  }

  saving.value = true
  error.value = ''
  try {
    const project = await api.createProject({
      title,
      department: form.department.trim(),
      summary: form.summary.trim(),
      requirement_type:
        form.requirementType === 'decision' || form.requirementType === 'sop'
          ? form.requirementType
          : undefined,
    })
    await router.push(`/projects/${project.id}`)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '项目创建失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="page-kicker">Intake / 新建需求</div>
        <h1>新建需求</h1>
        <p class="sub">先记录业务问题和背景，创建后即可上传材料并进入分析。</p>
      </div>
      <RouterLink class="btn" to="/">
        <ArrowLeft :size="15" aria-hidden="true" />
        <span>返回工作台</span>
      </RouterLink>
    </div>

    <section class="card card-pad intake-layout">
      <div>
        <div class="section-label">Start with context / 先建立上下文</div>
        <div class="card-title mt8">需求基本信息</div>
        <p class="card-sub">用于建立分析上下文，不会执行库存、上下架或 ERP 动作。</p>

        <form class="form" @submit.prevent="onSubmit">
          <label>
            需求标题
            <input v-model="form.title" type="text" placeholder="例如：滞销 SKU 处置判断" />
          </label>
          <label>
            提出部门
            <input v-model="form.department" type="text" placeholder="例如：运营 / 仓储" />
          </label>
          <label>
            需求形态
            <select v-model="form.requirementType">
              <option value="">暂不判断</option>
              <option value="decision">单点决策</option>
              <option value="sop">SOP 流程</option>
            </select>
          </label>
          <label>
            需求摘要
            <textarea v-model="form.summary" rows="5" placeholder="先用一句话说明业务要解决什么问题。创建后立刻进入 AI 一问一答澄清。" />
          </label>
          <div class="actions">
            <button class="btn btn-primary" type="submit" :disabled="saving">
              <FilePlus2 v-if="!saving" :size="15" aria-hidden="true" />
              {{ saving ? '创建中…' : '创建项目' }}
            </button>
          </div>
        </form>

        <p v-if="error" class="banner warn mt16">{{ error }}</p>
      </div>

      <aside class="intake-note">
        <div class="section-label">What happens next / 接下来</div>
        <h2>先把问题讲明白，再决定要做什么。</h2>
        <p>越接近真实业务语境，后续画像、方案和价值判断就越可靠。</p>
        <div class="intake-steps">
          <div class="intake-step">
            <span class="intake-step-index">01</span>
            <div><strong>创建需求上下文</strong><span>记录问题、部门与当前已知边界。</span></div>
          </div>
          <div class="intake-step">
            <span class="intake-step-index">02</span>
            <div><strong>补充材料与事实</strong><span>上传 SOP、访谈记录或已有说明。</span></div>
          </div>
          <div class="intake-step">
            <span class="intake-step-index">03</span>
            <div><strong>进入前置分析</strong><span>由规则与模型共同整理下一步。</span></div>
          </div>
        </div>
      </aside>
    </section>
  </div>
</template>
