<script setup lang="ts">
import type { ReportSiteData } from '../types'

defineProps<{ data: ReportSiteData }>()
</script>

<template>
  <div>
    <p v-if="data.status === 'unpublished'" class="muted">当前草稿尚未关联已发布网站，没有线上统计。</p>
    <template v-else>
      <p class="muted">所选页面：{{ data.pageTitle }}；网站：{{ data.siteName }}</p>
      <p class="muted">统计区间：{{ data.period.start }} 至 {{ data.period.end }}</p>
      <p class="muted">读取时间：{{ data.capturedAt }}</p>
      <p v-if="!data.analyticsEnabled" class="muted">当前网站已关闭行为采集，已有记录仍按统计区间显示。</p>
      <dl class="row">
        <div><dt>访客事件记录</dt><dd data-testid="report-event-count">{{ data.eventCount }}</dd></div>
        <div><dt>询盘数量</dt><dd data-testid="report-inquiry-count">{{ data.inquiryCount }}</dd></div>
      </dl>
      <ul v-if="data.events.length">
        <li v-for="event in data.events" :key="event.name">{{ event.name }}：{{ event.count }}</li>
      </ul>
      <p v-else class="muted">统计区间内没有该页面的事件记录。</p>
      <p v-if="data.eventsTruncated" class="muted">事件分类显示数量最多的 100 种，事件总量包含全部分类。</p>
      <p class="muted">事件数量按照采集记录计算，未包含联系人信息，也不代表独立访客人数。公开地址诊断中的统计属于这里标明的本站页面。</p>
    </template>
  </div>
</template>
