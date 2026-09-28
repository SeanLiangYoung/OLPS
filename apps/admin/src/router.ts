import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from './pages/LoginPage.vue'
import WorkspacePage from './pages/WorkspacePage.vue'
import DashboardPage from './pages/DashboardPage.vue'
import PagesPage from './pages/PagesPage.vue'
import PageDetailPage from './pages/PageDetailPage.vue'
import GeneratePage from './pages/GeneratePage.vue'
import PublishPage from './pages/PublishPage.vue'
import InquiriesPage from './pages/InquiriesPage.vue'
import IntegrationsPage from './pages/IntegrationsPage.vue'
import ReportsPage from './pages/ReportsPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import { getAccessToken, getSelectedDraftId } from './api'
import { resolveNavigationGuard } from './workspaceGuard'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', component: LoginPage },
    { path: '/workspace', component: WorkspacePage },
    { path: '/dashboard', component: DashboardPage },
    { path: '/pages', component: PagesPage },
    { path: '/drafts/:draftId/pages/:pageId', component: PageDetailPage },
    { path: '/generate', component: GeneratePage },
    { path: '/publish', component: PublishPage },
    { path: '/inquiries', component: InquiriesPage },
    { path: '/integrations', component: IntegrationsPage },
    { path: '/reports', component: ReportsPage },
    { path: '/settings', component: SettingsPage },
  ],
})

router.beforeEach((to) => {
  const result = resolveNavigationGuard(
    to.path,
    getAccessToken(),
    getSelectedDraftId(),
  )
  if (result === true) return true
  return result
})
