<script setup lang="ts">
import { reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'

const sent = ref(false)
const form = reactive({
  title: '',
  department: '',
  summary: '',
})

function onSubmit() {
  sent.value = true
}
</script>

<template>
  <div>
    <div class="page-bar">
      <h1>提出需求</h1>
      <RouterLink class="btn" to="/">取消</RouterLink>
    </div>

    <form class="form" @submit.prevent="onSubmit">
      <label class="field">
        <span>标题</span>
        <input v-model="form.title" type="text" required placeholder="要解决什么问题" />
      </label>
      <label class="field">
        <span>部门</span>
        <input v-model="form.department" type="text" placeholder="可选" />
      </label>
      <label class="field">
        <span>说明</span>
        <textarea v-model="form.summary" placeholder="已知事实写这里，不清楚的留空" />
      </label>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">提交</button>
        <span v-if="sent" class="hint">创建接口还没接上，这条不会落库。</span>
      </div>
    </form>
  </div>
</template>
