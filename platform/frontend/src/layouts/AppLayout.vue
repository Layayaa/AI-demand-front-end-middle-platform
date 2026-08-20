<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="shell">
    <a class="skip" href="#main">跳到内容</a>
    <div class="atmosphere" aria-hidden="true">
      <div class="blob blob-a" />
      <div class="blob blob-b" />
      <div class="blob blob-c" />
    </div>
    <div class="grain" aria-hidden="true" />

    <header class="topbar">
      <RouterLink class="brand" to="/" aria-label="需求前置工作台">
        <span class="brand-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 2c2.2 2.8 2.9 5 2.9 7.3 0 2.5-1.3 4.6-2.9 7-1.6-2.4-2.9-4.5-2.9-7C6.1 7 6.8 4.8 9 2z" fill="currentColor"/>
            <path d="M9 9.5V16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="brand-name">需求前置</span>
      </RouterLink>
      <nav class="nav" aria-label="主导航">
        <RouterLink to="/" :class="{ active: route.name === 'dashboard' }">工作台</RouterLink>
        <RouterLink to="/new" :class="{ active: route.name === 'intake' }">提出需求</RouterLink>
        <RouterLink to="/settings" :class="{ active: route.name === 'settings' }">设置</RouterLink>
      </nav>
    </header>

    <main id="main" class="stage">
      <RouterView />
    </main>
  </div>
</template>
