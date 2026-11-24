<script setup lang="ts">
import { computed,ref,watch } from 'vue'
import { api } from '../api'
import { selectedSiteIdState,selectedDraftIdState } from '../workspaceSession'
import { contentLocale } from '../cms-state'
type Issue={code:string;message:string;locale?:string;target?:{ref:string;id:string}}
type ContentReport={target:{ref:'page'|'collection'|'group'|'item';id:string};locale:string;title:string;seoTitle:boolean;seoDescription:boolean;inquiries:number;issues:Issue[]}
type Summary={total:number;issues:number;affected:number}
type Report={reportId:string;createdAt:string;summary:Summary|null;content:ContentReport[];issues:Issue[];legacy?:boolean;score?:number;checklist?:Array<{label:string;passed:boolean}>}
type History={reportId:string;createdAt:string;summary:Summary|null;score:number;legacy:boolean}
const report=ref<Report>(),history=ref<History[]>([]),error=ref(''),loading=ref(false)
const labels={page:'页面',collection:'内容列表',group:'内容分组',item:'内容条目'}
const content=computed(()=>report.value?.content.filter(item=>item.locale===contentLocale.value)??[])
const siteIssues=computed(()=>report.value?.issues.filter(issue=>!issue.target)??[])
let generation=0
function time(value:string):string{return new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}
function contentLink(item:ContentReport):string{return `/content/${item.target.ref}/${encodeURIComponent(item.target.id)}?locale=${encodeURIComponent(item.locale)}`}
async function loadHistory(siteId:string,current:number):Promise<void>{const result=await api<{reports:History[]}>('GET',`/api/sites/${encodeURIComponent(siteId)}/reports/history`);if(current===generation)history.value=result.reports}
async function load():Promise<void>{
  const current=++generation,siteId=selectedSiteIdState.value
  if(!siteId){report.value=undefined;history.value=[];return}
  loading.value=true;error.value=''
  try{
    const query=selectedDraftIdState.value?`?draftId=${encodeURIComponent(selectedDraftIdState.value)}`:''
    const result=await api<Report>('GET',`/api/sites/${encodeURIComponent(siteId)}/reports${query}`)
    if(current===generation)report.value=result
    await loadHistory(siteId,current)
  }catch(cause){if(current===generation)error.value=cause instanceof Error?cause.message:'检查暂时无法完成，请稍后重试。'}finally{if(current===generation)loading.value=false}
}
async function showHistory(reportId:string):Promise<void>{
  const siteId=selectedSiteIdState.value
  if(!reportId||!siteId)return
  const current=++generation;loading.value=true;error.value=''
  try{const result=await api<Report>('GET',`/api/sites/${encodeURIComponent(siteId)}/reports/${encodeURIComponent(reportId)}`);if(current===generation)report.value=result}catch{if(current===generation)error.value='暂时无法读取这份检查记录，请稍后重试。'}finally{if(current===generation)loading.value=false}
}
watch([selectedSiteIdState,selectedDraftIdState],()=>{report.value=undefined;history.value=[];void load()},{immediate:true})
</script>
<template>
  <el-card class="panel-card" shadow="never">
    <h1>统计与报告</h1>
    <p>检查全部语言的搜索结果信息、标题、图片、正文、站内链接与网站构建条件，并查看公开网站收到的询盘数量。</p>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
    <div class="report-actions">
      <el-button type="primary" :loading="loading" :disabled="!selectedSiteIdState" @click="load">{{ loading?'正在检查…':'重新检查' }}</el-button>
      <el-select
        v-if="history.length"
        aria-label="检查记录"
        :model-value="report?.reportId"
        :disabled="loading"
        style="width: 280px"
        @change="showHistory"
      >
        <el-option
          v-for="item in history"
          :key="item.reportId"
          :label="`${time(item.createdAt)} · ${item.legacy?'历史报告':`${item.summary?.issues??0}项提醒`}`"
          :value="item.reportId"
        />
      </el-select>
    </div>
    <el-alert
      v-if="report?.summary"
      :title="`已检查 ${report.summary.total} 份内容，其中 ${report.summary.affected} 份需要完善，共有 ${report.summary.issues} 项提醒。`"
      type="info"
      show-icon
      :closable="false"
      class="page-alert"
    />
    <p v-if="report">检查时间：{{ time(report.createdAt) }}</p>
    <ul v-if="siteIssues.length" class="report-issues">
      <li v-for="(issue,index) in siteIssues" :key="index">{{ issue.message }}</li>
    </ul>
    <template v-if="report?.legacy">
      <h2>历史报告</h2>
      <p>检查得分：{{ report.score }}</p>
      <ul>
        <li v-for="(item,index) in report.checklist" :key="index">
          {{ item.label }}：
          <el-tag size="small" :type="item.passed ? 'success' : 'warning'">{{ item.passed?'通过':'需要完善' }}</el-tag>
        </li>
      </ul>
    </template>
    <template v-else>
      <el-empty v-if="!loading&&!content.length" description="这个语言还没有可显示的内容。" :image-size="72" />
      <div v-for="item in content" :key="`${item.target.ref}:${item.target.id}:${item.locale}`" class="content-report">
        <div class="content-report-heading">
          <h2>{{ item.title }}</h2>
          <el-tag size="small">{{ labels[item.target.ref] }}</el-tag>
          <RouterLink :to="contentLink(item)">编辑内容</RouterLink>
        </div>
        <p>
          搜索标题：
          <el-tag size="small" :type="item.seoTitle ? 'success' : 'warning'">{{ item.seoTitle?'已填写':'待完善' }}</el-tag>
          · 搜索描述：
          <el-tag size="small" :type="item.seoDescription ? 'success' : 'warning'">{{ item.seoDescription?'已填写':'待完善' }}</el-tag>
          · 公开询盘：{{ item.inquiries }}
        </p>
        <ul v-if="item.issues.length">
          <li v-for="(issue,index) in item.issues" :key="index">{{ issue.message }}</li>
        </ul>
        <p v-else>这份内容已通过当前检查。</p>
      </div>
    </template>
  </el-card>
</template>
<style scoped>
.panel-card h1 { margin-top: 0; }
.page-alert { margin-bottom: 12px; }
.report-actions,.content-report-heading{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.content-report{border-top:1px solid var(--el-border-color-lighter);padding:1rem 0}
.content-report h2{margin:0}
.content-report ul,.report-issues{color:var(--el-color-warning-dark-2);line-height:1.8}
.content-report-heading a{margin-left:auto}
</style>
