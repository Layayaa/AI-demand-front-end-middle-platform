<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="shell">
    <aside class="rail">
      <div class="mark">
        <svg width="13" height="16" viewBox="0 0 13 16" aria-hidden="true">
          <path fill="#f3ead9" d="M0 0h9l4 4v12H0V0z" />
          <path fill="#9c311f" d="M9 0v4h4" />
        </svg>
        <span class="mark-name">需求前置</span>
      </div>
      <nav class="nav">
        <RouterLink to="/" :class="{ active: route.name === 'dashboard' }">工作台</RouterLink>
        <RouterLink to="/new" :class="{ active: route.name === 'intake' }">提出需求</RouterLink>
        <RouterLink to="/settings" :class="{ active: route.name === 'settings' }">设置</RouterLink>
      </nav>
      <div class="rail-foot">把材料聊清楚<br>再写方案</div>
    </aside>
    <main class="stage">
      <RouterView />
    </main>
  </div>
</template>
