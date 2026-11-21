<script setup lang="ts">
import { computed,ref,watch } from 'vue'
import { api } from '../api'
import { selectedSiteIdState,selectedSiteNameState,selectedDraftIdState } from '../workspaceSession'
import { contentLocale } from '../cms-state'

type Metric={value:number|null;days:number}
type Spend={currency:string;amount:number;days:number;inquiries:number;qualified:number;costPerInquiry:number|null;costPerQualifiedInquiry:number|null;costUnavailableReason:string|null}
type Platform={connector:'ga4'|'googleAds'|'meta'|'searchConsole';status:'not_synced'|'partial'|'synced';availableDays:number;expectedDays:number;lastSyncedAt:string|null;connectionStatus:string;metrics:Record<string,Metric>;spend:Spend[];unknownSpend:Array<{date:string;amount:number|null}>;sourceInquiries:number;qualifiedSourceInquiries:number}
type Overview={counts:{pages:number;collections:number;groups:number;items:number};marketing:{period:{from:string;to:string;timeZone:string;days:number};native:{pageViews:number};inquiries:{total:number;qualified:number;sources:Array<{source:string;total:number;qualified:number}>};platforms:Platform[]}}
const data=ref<Overview>(),error=ref(''),loading=ref(false)
const platformNames={ga4:'Google 网站统计',googleAds:'Google 广告',meta:'Meta 广告',searchConsole:'Google 搜索表现'}
const metricNames:Record<string,string>={activeUsers:'每日活跃用户累计',sessions:'访问会话',pageViews:'平台页面浏览',keyEvents:'关键事件',impressions:'展示次数',clicks:'点击次数',conversions:'平台归因转化',platformLeads:'平台线索',websiteLeads:'网站线索',onsiteLeads:'站内线索'}
const sourceNames:Record<string,string>={googleAds:'Google 广告来源',meta:'Meta 广告来源',ambiguous:'同时包含多个广告平台标识',other:'其他或未标记的来源'}
const connectionNames:Record<string,string>={connected:'已连接',disconnected:'已断开',needs_reconnect:'需要重新连接',not_connected:'尚未连接'}
const cards=computed(()=>data.value?[{value:data.value.counts.pages,label:'当前语言的页面',to:'/pages'},{value:data.value.counts.collections,label:'当前语言的内容类型',to:'/collections'},{value:data.value.counts.items,label:'当前语言的内容条目',to:'/collections'},{value:data.value.marketing.inquiries.total,label:'最近30天公开询盘',to:'/inquiries'},{value:data.value.marketing.inquiries.qualified,label:'其中已标记有效',to:'/inquiries'},{value:data.value.marketing.native.pageViews,label:'已同意统计的页面浏览',to:'/reports'}]:[])
let epoch=0
function number(value:number):string{return new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value)}
function money(value:number,currency:string):string{return new Intl.NumberFormat('zh-CN',{style:'currency',currency}).format(value)}
function time(value:string):string{return new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}
async function load():Promise<void>{
  const current=++epoch;data.value=undefined;error.value=''
  const siteId=selectedSiteIdState.value,draftId=selectedDraftIdState.value
  if(!siteId||!draftId)return
  loading.value=true
  try{
    const result=await api<Overview>('GET',`/api/sites/${encodeURIComponent(siteId)}/overview?draftId=${encodeURIComponent(draftId)}&locale=${encodeURIComponent(contentLocale.value)}`)
    if(current===epoch)data.value=result
  }catch{if(current===epoch)error.value='网站概况暂时无法读取，请检查访问权限后重试。'}finally{if(current===epoch)loading.value=false}
}
watch([selectedSiteIdState,selectedDraftIdState,contentLocale],load,{immediate:true})
</script>
<template>
  <section>
    <h1>{{ selectedSiteNameState }} · 网站概况</h1>
    <p>编辑内容保存在当前编辑版本中，发布后访客可以看到这些更改。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="loading" role="status">正在读取网站概况…</p>
    <template v-if="data">
      <div class="cms-metrics"><RouterLink v-for="card in cards" :key="card.label" class="panel" :to="card.to"><strong>{{ number(card.value) }}</strong><span>{{ card.label }}</span></RouterLink></div>
      <section class="panel"><h2>网站访问与公开询盘</h2><p>统计日期：{{ data.marketing.period.from }} 至 {{ data.marketing.period.to }}，按世界标准时间统计。页面浏览仅包含访客同意统计后发送的事件。询盘按创建时间计数，排除预览提交；已标记有效包含之后已经处理的有效询盘。</p><ul><li v-for="source in data.marketing.inquiries.sources" :key="source.source">{{ sourceNames[source.source] }}：{{ number(source.total) }} 条公开询盘，其中 {{ number(source.qualified) }} 条已标记有效。</li></ul></section>
      <section class="panel"><h2>最近30天的平台指标</h2><p>各平台分别显示，数据通常更新至昨天。尚未同步的指标保留状态提示。Google 网站统计的每日活跃用户累计可能跨日重复；广告转化按平台归因规则计算，Meta 各类线索分别显示。</p>
        <div class="platform-grid"><article v-for="platform in data.marketing.platforms" :key="platform.connector" class="platform-card" :data-platform="platform.connector">
          <h3>{{ platformNames[platform.connector] }}</h3><p>{{ connectionNames[platform.connectionStatus] }}</p>
          <p v-if="platform.status==='not_synced'" class="sync-status">尚未同步</p><p v-else class="sync-status">已同步 {{ platform.availableDays }} / {{ platform.expectedDays }} 天</p>
          <p v-if="platform.lastSyncedAt">最近同步：{{ time(platform.lastSyncedAt) }}</p>
          <dl><template v-for="(metric,key) in platform.metrics" :key="key"><dt>{{ metricNames[String(key)] }}</dt><dd v-if="metric.value===null">{{ platform.status==='not_synced'?'尚未同步':'平台未提供' }}</dd><dd v-else>{{ number(metric.value) }} <small>（{{ metric.days }} 天）</small></dd></template></dl>
          <template v-if="platform.connector==='googleAds'||platform.connector==='meta'">
            <p>广告来源询盘：{{ number(platform.sourceInquiries) }}，已标记有效：{{ number(platform.qualifiedSourceInquiries) }}</p>
            <p v-if="!platform.spend.length&&!platform.unknownSpend.length">花费：尚未同步</p>
            <section v-for="spend in platform.spend" :key="spend.currency" class="spend"><h4>{{ spend.currency }} 花费：{{ money(spend.amount,spend.currency) }}</h4><p>覆盖 {{ spend.days }} 天；同期来源询盘 {{ spend.inquiries }} 条，其中 {{ spend.qualified }} 条已标记有效。</p><p>每条来源询盘成本：{{ spend.costPerInquiry===null?'无法计算':money(spend.costPerInquiry,spend.currency) }}</p><p>每条有效来源询盘成本：{{ spend.costPerQualifiedInquiry===null?'无法计算':money(spend.costPerQualifiedInquiry,spend.currency) }}</p><p v-if="spend.costUnavailableReason">{{ spend.costUnavailableReason }}</p></section>
            <details v-if="platform.unknownSpend.length"><summary>查看币种未提供的每日花费</summary><p>这些数据逐条显示，不计算总花费和询盘成本。</p><ul><li v-for="(spend,index) in platform.unknownSpend" :key="index">{{ spend.date }}：{{ spend.amount===null?'平台未提供花费':number(spend.amount) }}（币种未提供）</li></ul></details>
          </template>
        </article></div>
        <details class="metric-explanation"><summary>广告来源与成本的计算方式</summary><p>广告来源根据点击标识或付费来源标签识别。仅有 Meta 浏览器标识的访问不归入广告来源，同时包含两个平台点击标识的询盘单独显示。成本使用同一平台、同一币种、已经同步日期的花费，除以这些日期收到的对应来源询盘。这个数值用于了解网站询盘成本，与平台转化成本分别计算。当天出现多个币种或币种不明的花费时，不计算来源询盘成本。不同平台和币种之间不合计。</p></details>
        <RouterLink to="/integrations">管理营销连接</RouterLink>
      </section>
      <section class="panel"><h2>管理网站内容</h2><p>维护页面、整理产品与文章、上传图片，或者使用网站资料生成内容。</p><div class="row"><RouterLink class="btn" to="/pages">管理页面</RouterLink><RouterLink class="btn secondary" to="/knowledge">网站资料</RouterLink><RouterLink class="btn secondary" to="/generate">AI 建站</RouterLink></div></section>
    </template>
  </section>
</template>
<style scoped>
.cms-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:28px 0}.cms-metrics a{display:flex;flex-direction:column;text-decoration:none;color:inherit}.cms-metrics strong{font-size:34px;margin-bottom:12px}.platform-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.platform-card{border:1px solid var(--line);border-radius:8px;padding:1rem}.platform-card dl{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}.platform-card dd{margin:0;text-align:right}.platform-card small{color:#536b7c}.sync-status{color:#536b7c}.spend,.metric-explanation{border-top:1px solid var(--line);margin-top:1rem;padding-top:.7rem}@media(max-width:760px){.cms-metrics,.platform-grid{grid-template-columns:1fr}}
</style>
