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
        <p class="sub">先用自己的话说出想解决的问题，AI 会一步步帮你梳理清楚。</p>
      </div>
      <RouterLink class="btn" to="/">
        <ArrowLeft :size="15" aria-hidden="true" />
        <span>返回工作台</span>
      </RouterLink>
    </div>

    <section class="card card-pad intake-layout">
      <div>
        <div class="section-label">Start with a thought / 从一个想法开始</div>
        <div class="card-title mt8">你现在想解决什么问题？</div>
        <p class="card-sub">不需要提前准备完整需求或材料，先说清楚当前困扰即可。</p>

        <form class="form" @submit.prevent="onSubmit">
          <label>
            需求标题
            <input v-model="form.title" type="text" placeholder="例如：每周预测采购量太耗时间" />
          </label>
          <label>
            目前的情况或困扰
            <textarea v-model="form.summary" rows="6" placeholder="例如：每周要从几个系统导出销量、库存和在途数据，再人工判断采购量，整理一遍大约需要半天。" />
          </label>
          <details class="intake-advanced">
            <summary>我知道更多信息，可以先补充</summary>
            <div class="form mt16">
              <label>
                提出部门（选填）
                <input v-model="form.department" type="text" placeholder="例如：运营 / 仓储" />
              </label>
              <label>
                需求形态（不确定可以不选）
                <select v-model="form.requirementType">
                  <option value="">交给 AI 判断</option>
                  <option value="decision">需要做一个判断</option>
                  <option value="sop">需要按步骤跑流程</option>
                </select>
              </label>
            </div>
          </details>
          <div class="actions">
            <button class="btn btn-primary" type="submit" :disabled="saving">
              <FilePlus2 v-if="!saving" :size="15" aria-hidden="true" />
              {{ saving ? '创建中…' : '开始 AI 梳理' }}
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
            <div><strong>先说出当前困扰</strong><span>不要求使用专业术语，也不要求准备材料。</span></div>
          </div>
          <div class="intake-step">
            <span class="intake-step-index">02</span>
            <div><strong>AI 一次问一个问题</strong><span>只追问真正影响方案的事实和边界。</span></div>
          </div>
          <div class="intake-step">
            <span class="intake-step-index">03</span>
            <div><strong>确认 AI 的理解</strong><span>核心信息足够后即可提交，其余稍后补充。</span></div>
          </div>
        </div>
      </aside>
    </section>
  </div>
</template>
