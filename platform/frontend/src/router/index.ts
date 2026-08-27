import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import DashboardView from '../views/DashboardView.vue'
import IntakeView from '../views/IntakeView.vue'
import DetailView from '../views/DetailView.vue'
import SettingsView from '../views/SettingsView.vue'
import LoginView from '../views/LoginView.vue'
import ClarifyView from '../views/ClarifyView.vue'
import { getSession } from '../auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { title: '登录' } },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', name: 'dashboard', component: DashboardView, meta: { title: '工作台', requiresAuth: true } },
        { path: 'new', name: 'intake', component: IntakeView, meta: { title: '新建需求', requiresAuth: true, role: 'requester' } },
        { path: 'projects/:id', name: 'detail', component: DetailView, meta: { title: '需求详情', requiresAuth: true } },
        { path: 'projects/:id/clarify', name: 'clarify', component: ClarifyView, meta: { title: 'AI 澄清', requiresAuth: true, role: 'requester' } },
        { path: 'settings', name: 'settings', component: SettingsView, meta: { title: '设置', requiresAuth: true, role: 'reviewer' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const session = getSession()
  if (to.meta.requiresAuth && !session) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.role && session?.user.role !== to.meta.role) {
    return { name: 'dashboard' }
  }
  if (to.name === 'login' && session) {
    return { name: 'dashboard' }
  }
  return true
})

router.afterEach((to) => {
  const page = typeof to.meta.title === 'string' ? to.meta.title : '工作台'
  document.title = `${page} · AI 需求前置分析中台`
})

export default router
