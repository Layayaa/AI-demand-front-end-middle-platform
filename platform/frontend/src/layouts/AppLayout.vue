<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { dotClass, usePlatformStatus } from '../composables/usePlatformStatus'

const route = useRoute()
const { healthOk, dbOk, llmConfigured } = usePlatformStatus()
</script>

<template>
  <div class="shell">
    <a class="skip" href="#main">跳到内容</a>
    <aside class="rail">
      <RouterLink class="brand" to="/">
        <span class="brand-mark" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
            <path d="M9 2c2.2 2.8 2.9 5 2.9 7.3 0 2.5-1.3 4.6-2.9 7-1.6-2.4-2.9-4.5-2.9-7C6.1 7 6.8 4.8 9 2z" fill="currentColor"/>
          </svg>
        </span>
        需求前置
      </RouterLink>
      <nav class="nav" aria-label="主导航">
        <RouterLink to="/" :class="{ active: route.name === 'dashboard' || route.name === 'detail' }">工作台</RouterLink>
        <RouterLink to="/new" :class="{ active: route.name === 'intake' }">提出需求</RouterLink>
        <RouterLink to="/settings" :class="{ active: route.name === 'settings' }">设置</RouterLink>
      </nav>
      <div class="rail-status" aria-label="运行状态">
        <span><i class="dot" :class="dotClass(healthOk)" />服务{{ healthOk ? '正常' : healthOk === false ? '未接通' : '…' }}</span>
        <span><i class="dot" :class="dotClass(dbOk)" />数据库{{ dbOk ? '已连接' : dbOk === false ? '未连接' : '…' }}</span>
        <span><i class="dot" :class="llmConfigured ? 'ok' : llmConfigured === false ? 'warn' : ''" />模型{{ llmConfigured ? '已配置' : llmConfigured === false ? '未配置' : '…' }}</span>
      </div>
    </aside>
    <main id="main" class="stage">
      <RouterView />
    </main>
  </div>
</template>
