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
    <div class="headline">
      <h1>提出需求</h1>
      <RouterLink class="btn" to="/">返回</RouterLink>
    </div>

    <form class="compose" @submit.prevent="onSubmit">
      <label>
        <span class="lbl">标题</span>
        <input v-model="form.title" class="title-input" type="text" placeholder="这条需求要解决什么" />
      </label>
      <label>
        <span class="lbl">部门</span>
        <input v-model="form.department" type="text" placeholder="提出人所属部门" />
      </label>
      <label>
        <span class="lbl">说明</span>
        <textarea v-model="form.summary" placeholder="先写已知事实。不清楚的地方留空，后面再澄清。" />
      </label>
      <div class="compose-actions">
        <button class="btn btn-solid" type="submit">记下这条</button>
      </div>
    </form>

    <p v-if="sent" class="hint">
      创建接口还没迁过来，这条不会落库。完整提交仍走原平台。
    </p>
  </div>
</template>
