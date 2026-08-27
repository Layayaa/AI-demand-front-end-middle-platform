<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, LogIn, UserPlus } from 'lucide-vue-next'
import { setSession } from '../auth'
import { api } from '../api/client'


const router = useRouter()
const mode = ref<'login' | 'register'>('login')
const submitting = ref(false)
const error = ref('')
const form = reactive({
  displayName: '',
  username: '',
  password: '',
})
const submitLabel = computed(() => (mode.value === 'login' ? '登录工作台' : '注册并开始'))

async function submit() {
  submitting.value = true
  error.value = ''
  try {
    const session =
      mode.value === 'login'
        ? await api.login({ username: form.username.trim(), password: form.password })
        : await api.register({
            display_name: form.displayName.trim(),
            username: form.username.trim(),
            password: form.password,
          })
    setSession(session)
    await router.replace('/')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '操作失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-intro">
      <div class="auth-mark" aria-hidden="true"><ArrowRight :size="22" /></div>
      <div class="page-kicker">AI Requirement Hub</div>
      <h1>先把需求<br />说清楚。</h1>
      <p>用一问一答梳理业务场景、事实和待确认项，让评审从更可靠的需求画像开始。</p>
    </section>

    <section class="auth-panel" aria-label="账号登录或注册">
      <div class="auth-tabs" role="tablist" aria-label="账号操作">
        <button
          type="button"
          class="auth-tab"
          :class="{ active: mode === 'login' }"
          role="tab"
          :aria-selected="mode === 'login'"
          @click="mode = 'login'"
        >
          登录
        </button>
        <button
          type="button"
          class="auth-tab"
          :class="{ active: mode === 'register' }"
          role="tab"
          :aria-selected="mode === 'register'"
          @click="mode = 'register'"
        >
          注册需求人账号
        </button>
      </div>

      <div class="auth-head">
        <div class="section-label">{{ mode === 'login' ? 'Welcome back / 登录' : 'Requester registration / 注册' }}</div>
        <h2>{{ mode === 'login' ? '进入你的需求工作台' : '创建需求人账号' }}</h2>
        <p>{{ mode === 'login' ? '需求人和评审人使用各自账号登录。' : '评审人账号由管理员预置，不在这里注册。' }}</p>
      </div>

      <form class="form auth-form" @submit.prevent="submit">
        <label v-if="mode === 'register'">
          姓名
          <input v-model="form.displayName" autocomplete="name" placeholder="例如：陈小明" />
        </label>
        <label>
          账号
          <input v-model="form.username" autocomplete="username" placeholder="至少 3 个字符，不含空格" />
        </label>
        <label>
          密码
          <input v-model="form.password" type="password" autocomplete="current-password" placeholder="至少 8 个字符" />
        </label>
        <button class="btn btn-primary auth-submit" type="submit" :disabled="submitting">
          <LogIn v-if="mode === 'login' && !submitting" :size="16" aria-hidden="true" />
          <UserPlus v-else-if="!submitting" :size="16" aria-hidden="true" />
          <span>{{ submitting ? '处理中…' : submitLabel }}</span>
        </button>
      </form>
      <p v-if="error" class="banner warn auth-error">{{ error }}</p>
    </section>
  </main>
</template>
