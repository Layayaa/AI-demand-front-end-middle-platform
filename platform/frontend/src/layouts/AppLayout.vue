<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'
import {
  Compass,
  LayoutDashboard,
  LogOut,
  PlusSquare,
  Settings,
  Sparkles,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { clearSession, switchTestRole, useAuth } from '../auth'

const route = useRoute()
const router = useRouter()
const { user, isReviewer, isTestSwitchMode, testRole } = useAuth()

function isActive(name: string) {
  return route.name === name
}

async function signOut() {
  clearSession()
  await router.replace('/login')
}

async function selectTestRole(role: 'requester' | 'reviewer') {
  switchTestRole(role)
  await router.replace('/')
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><Compass :size="20" :stroke-width="2.2" /></div>
      <div>
        <div class="brand-name">需求前置分析中台</div>
        <div class="brand-sub">AI REQUIREMENT HUB</div>
      </div>
      </div>
      <nav class="nav">
        <div class="nav-label">Workspace</div>
        <RouterLink class="nav-item" :class="{ active: isActive('dashboard') }" to="/">
          <LayoutDashboard :size="17" aria-hidden="true" />
          <span>{{ isReviewer ? '评审工作台' : '我的需求' }}</span>
        </RouterLink>
        <RouterLink v-if="!isReviewer" class="nav-item" :class="{ active: isActive('intake') }" to="/new">
          <PlusSquare :size="17" aria-hidden="true" />
          <span>新建需求</span>
        </RouterLink>
        <RouterLink v-if="isReviewer" class="nav-item" :class="{ active: isActive('settings') }" to="/settings">
          <Settings :size="17" aria-hidden="true" />
          <span>设置</span>
        </RouterLink>
      </nav>
      <div v-if="isTestSwitchMode" class="test-role-switch" aria-label="测试角色切换">
        <div class="nav-label">Test role</div>
        <div class="test-role-options">
          <button
            type="button"
            :class="{ active: testRole === 'requester' }"
            @click="selectTestRole('requester')"
          >
            需求人
          </button>
          <button
            type="button"
            :class="{ active: testRole === 'reviewer' }"
            @click="selectTestRole('reviewer')"
          >
            评审人
          </button>
        </div>
      </div>
      <div class="sidebar-foot">
        <div class="ai-mode-badge">
          <Sparkles :size="15" aria-hidden="true" />
          <span>{{ isReviewer ? '评审人视图' : '需求人视图' }}</span>
        </div>
        <p class="sidebar-tip">{{ user?.displayName }} · {{ isReviewer ? '内部评审权限' : '只查看自己的需求' }}</p>
        <button v-if="!isTestSwitchMode" class="nav-item signout" type="button" @click="signOut">
          <LogOut :size="17" aria-hidden="true" />
          <span>退出登录</span>
        </button>
      </div>
    </aside>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>
