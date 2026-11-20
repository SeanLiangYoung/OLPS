# 直接复用 vs 需要重做

> 对照旧 LPS 与当前 open-lps 需求。见 [site-collaboration.md](site-collaboration.md)、[packages.md](packages.md)。

运营走后台模块页 → HTTP API；命令行与外部系统 → 同一套 API / CLI。
请求一律：**Bearer accessToken**；编辑带 **draftId**，线上数据带 **siteId**。

---

## 一、直接复用

| 内容 | 怎么用 |
|------|--------|
| **specs（只读）、skills、CLI/能力表** | 在当前草稿下调用；由模块页或自动化触发 |
| **评分报告、行为采集、询盘对接** | 复用；询盘增加语言与广告来源 |
| **本系统账号、网站与草稿所有权、Pull/Push、Agent 冲突处理** | `@olps/sync`、远端服务、continue 接口保持现有实现 |
| **模型调用** | OpenAI 兼容接口，默认 DeepSeek |
| **知识库资料读写能力** | 改为每个网站一个知识库；跨网站通过复制资料使用 |

---

## 二、明确不带

| 内容 | 原因 |
|------|------|
| 对话配完整站 / 对话猜上下文 / 对话工作台主壳 | 显式选草稿 + 后台模块页管站 |
| 巡检策略 | 评价走报告 |
| 企业知识库设置块 | 流程里选库 |
| DeerFlow 等 | 历史债 |

---

## 三、需要重做 / 新做

| 内容 | 说明 |
|------|------|
| 内容模型 | 必备页面、树形内容类型、媒体、按语言保存的区块树，见 [page-model.md](page-model.md) |
| 后台 | WordPress 式菜单与模块，见 [admin.md](admin.md) |
| 可视化编辑器 | 区块式编辑器，画布使用 `packages/render` |
| AI 生成 | AI 建站结构树、按区块生成、重写单个区块、翻译，见 [ai-generation.md](ai-generation.md) |
| 主题与插件 | Liquid 主题、isolated-vm 插件、zip 安装，见 [themes.md](themes.md)、[plugins.md](plugins.md) |
| 营销集成 | Google、Meta 授权连接，标准事件，Cookie 同意，服务器端转化，见 [integrations.md](integrations.md) |
| 多语言 | 中英文内置、可添加语言、全部语言带前缀，见 [localization.md](localization.md) |
| 静态构建与发布 | 纯静态产物、隐藏文件、发布目标、只发布静态资源，见 [static-output.md](static-output.md) |

---

## 四、总表

| 类别 | 复用 | 重做 | 不带 |
|------|------|------|------|
| 账号与协作 | 账号、所有权、草稿、Push/Pull | 发布对话框、发布目标 | — |
| 技能与生成 | specs/skills/评分/知识库 | 区块式 AI 生成与翻译 | 平行重写 |
| 网站 | 询盘 | 内容模型、主题、插件、静态构建、SEO 与 GEO | — |
| 界面 | 可抽组件 | WordPress 式后台、可视化编辑器 | 对话壳；巡检/知识库开关 |

实施顺序见 [plans/2026-11-19-wp-style-cms-implementation.md](plans/2026-11-19-wp-style-cms-implementation.md)。

按文件划分的处置方式与测试保留规则见 [design/code-disposition.md](design/code-disposition.md)。
