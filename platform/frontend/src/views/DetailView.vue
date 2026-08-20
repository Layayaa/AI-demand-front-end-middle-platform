<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import UiCard from '../components/UiCard.vue'

const route = useRoute()
const projectId = computed(() => String(route.params.id || ''))
</script>

<template>
  <div class="page">
    <div>
      <p class="crumb">
        <RouterLink to="/">工作台</RouterLink>
        <span> / {{ projectId }}</span>
      </p>
      <div class="headline">
        <h1>需求详情</h1>
        <RouterLink class="btn btn-ghost btn-sm" to="/">返回</RouterLink>
      </div>
    </div>

    <div class="sections">
      <UiCard shape="a">
        <h2 class="font-heading">画像</h2>
        <p class="quiet">尚无结构化画像。</p>
      </UiCard>
      <UiCard shape="b">
        <h2 class="font-heading">澄清</h2>
        <p class="quiet">尚无对话记录。</p>
      </UiCard>
      <UiCard shape="d">
        <h2 class="font-heading">方案</h2>
        <p class="quiet">尚未生成产品版 / 技术版。</p>
      </UiCard>
    </div>
  </div>
</template>
