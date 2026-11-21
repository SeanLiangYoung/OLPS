import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from './pages/LoginPage.vue'
import CmsSitesPage from './pages/CmsSitesPage.vue'
import CmsOverviewPage from './pages/CmsOverviewPage.vue'
import CmsContentsPage from './pages/CmsContentsPage.vue'
import CmsEditorPage from './pages/CmsEditorPage.vue'
import CmsKnowledgePage from './pages/CmsKnowledgePage.vue'
import CmsMediaPage from './pages/CmsMediaPage.vue'
import GeneratePage from './pages/CmsAiPage.vue'
import PublishPage from './pages/CmsPublishPage.vue'
import InquiriesPage from './pages/CmsInquiriesPage.vue'
import IntegrationsPage from './pages/CmsIntegrationsPage.vue'
import ReportsPage from './pages/CmsReportsPage.vue'
import SettingsPage from './pages/CmsSettingsPage.vue'
import CmsAppearancePage from './pages/CmsAppearancePage.vue'
import CmsPluginsPage from './pages/CmsPluginsPage.vue'
import { getAccessToken, getSelectedDraftId } from './api'
import { resolveNavigationGuard } from './workspaceGuard'
import { selectedSiteIdState } from './workspaceSession'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', component: LoginPage },
    { path: '/sites', component: CmsSitesPage },
    { path: '/workspace', redirect: '/sites' },
    { path: '/dashboard', component: CmsOverviewPage },
    { path: '/pages', component: CmsContentsPage },
    { path: '/collections', component: CmsContentsPage },
    { path: '/collections/:collectionId', component: CmsContentsPage },
    { path: '/content/:ref/:id', component: CmsEditorPage },
    { path: '/knowledge', component: CmsKnowledgePage },
    { path: '/media', component: CmsMediaPage },
    { path: '/generate', component: GeneratePage },
    { path: '/publish', component: PublishPage },
    { path: '/inquiries', component: InquiriesPage },
    { path: '/integrations', component: IntegrationsPage },
    { path: '/reports', component: ReportsPage },
    { path: '/settings', component: SettingsPage },
    { path: '/settings/:section', component: SettingsPage },
    { path: '/appearance/:section', component: CmsAppearancePage },
    { path: '/plugins', component: CmsPluginsPage },
  ],
})

router.beforeEach((to) => {
  const result = resolveNavigationGuard(
    to.path,
    getAccessToken(),
    getSelectedDraftId(),
    selectedSiteIdState.value,
  )
  if (result === true) return true
  return result
})
