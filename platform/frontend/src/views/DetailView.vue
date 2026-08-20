<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
const projectId = computed(() => String(route.params.id || ''))
</script>

<template>
  <div>
    <div class="crumb">
      <RouterLink to="/">工作台</RouterLink>
      <span> / {{ projectId }}</span>
    </div>
    <div class="headline">
      <h1>需求详情</h1>
      <RouterLink class="btn" to="/">返回</RouterLink>
    </div>

    <div class="sections">
      <section class="section">
        <h2>画像</h2>
        <p>尚无结构化画像。</p>
      </section>
      <section class="section">
        <h2>澄清</h2>
        <p>尚无对话记录。</p>
      </section>
      <section class="section">
        <h2>方案</h2>
        <p>尚未生成产品版 / 技术版。</p>
      </section>
    </div>
  </div>
</template>
