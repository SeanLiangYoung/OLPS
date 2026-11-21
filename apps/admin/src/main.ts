import { createApp } from 'vue'
import App from './CmsApp.vue'
import { router } from './router'

createApp(App).use(router).mount('#app')
