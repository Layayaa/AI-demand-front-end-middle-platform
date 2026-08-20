import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import DashboardView from '../views/DashboardView.vue'
import IntakeView from '../views/IntakeView.vue'
import DetailView from '../views/DetailView.vue'
import SettingsView from '../views/SettingsView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', name: 'dashboard', component: DashboardView, meta: { title: '工作台' } },
        { path: 'new', name: 'intake', component: IntakeView, meta: { title: '提出需求' } },
        { path: 'projects/:id', name: 'detail', component: DetailView, meta: { title: '需求详情' } },
        { path: 'settings', name: 'settings', component: SettingsView, meta: { title: '设置' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.afterEach((to) => {
  const page = typeof to.meta.title === 'string' ? to.meta.title : '工作台'
  document.title = `${page} · 需求前置`
})

export default router
