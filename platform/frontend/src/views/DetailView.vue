<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
const projectId = computed(() => String(route.params.id || ''))
</script>

<template>
  <div class="doc">
    <p class="crumb">
      <RouterLink to="/">项目</RouterLink>
      <span> / {{ projectId }}</span>
    </p>
    <div class="page-bar">
      <h1>需求详情</h1>
      <RouterLink class="btn" to="/">返回列表</RouterLink>
    </div>
    <section class="section">
      <h2>画像</h2>
      <p>还没有结构化画像。</p>
    </section>
    <section class="section">
      <h2>澄清</h2>
      <p>还没有对话。</p>
    </section>
    <section class="section">
      <h2>方案</h2>
      <p>还没有产品版 / 技术版。</p>
    </section>
  </div>
</template>
