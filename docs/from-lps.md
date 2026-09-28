# 从旧 LPS 带走什么、丢掉什么

> 与 [architecture.md](architecture.md)、[site-collaboration.md](site-collaboration.md)、[packages.md](packages.md) 一致。

## 1. 同一套能力暴露

| 调用方 | 路径 |
|--------|------|
| 运营后台模块页 | 页面 → HTTP API → 管理 API / 远端 |
| 命令行 / 自动化（含已验证技能触发的 CLI） | CLI → 服务 |
| 外部系统 | 直调 HTTP API → 服务 |

一律：**Bearer accessToken**；编辑带 **draftId**，线上数据带 **siteId**。  
运营主路径是模块页；对话工作台不作为产品壳。

## 2. 本仓库自行实现（对照 LPS 经验，不链接其代码）

| 能力 | 策略 |
|------|------|
| **用户账号 + 所有权** | 本仓库 PostgreSQL 与会话 |
| 类型与 Guide 校验 | `@olps/domain` |
| 生成 / 草稿 / Push·Pull | `services/api` + `@olps/sync` + `services/remote` + `apps/admin` |

## 3. 不带进 open-lps 的壳与设置

| 旧形态 | 态度 |
|--------|------|
| 对话完成整站 / 对话猜上下文 / 对话工作台主壳 | Admin 模块页 + 显式选草稿 |
| 品牌 Logo、巡检策略、Guide 文档流 | 不带 |
| 企业知识库设置块 | 流程中选库 |

## 4. 代码策略

1. open-lps 独立实现，不依赖 LPS 仓库路径或 npm 包。  
2. 产品规则以本仓库 `docs/` 为准。  
3. 工作上下文：登录后选择草稿 + 请求携带 accessToken。
