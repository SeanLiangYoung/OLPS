# Open Landing Page System

网站内容管理系统：登录后选择网站，在可视化编辑器中点击修改文字、图片、按钮和内容区域。保存后选择准备好的页面发布，访客通过浏览器访问独立远端服务提供的网站。

用户可以拥有多个网站，每个网站和草稿可以有多个所有者。

## 本地运行

安装并启动 Docker Desktop，在仓库根目录执行：

```bash
docker compose up -d --build --wait
```

该命令构建并启动 PostgreSQL、管理 API、独立远端服务及管理后台，等待服务健康检查通过。Docker 运行所需配置由 Compose 提供。

管理后台：`http://127.0.0.1:5173`。注册或登录后，在“我的网站”创建或选择网站，进行编辑、AI 生成和多人协作。

管理 API：`http://127.0.0.1:8787/api/health`。远端服务：`http://127.0.0.1:8790`，Push 成功后使用返回的 `/s/:remoteSiteId/` 网站地址。

启动、停止、备份恢复、测试及直接运行源码的步骤见 [docs/local-docker.md](docs/local-docker.md)。当前计划见 [docs/plans/2026-10-25-complete-cms.md](docs/plans/2026-10-25-complete-cms.md)，操作验收见 [docs/cms-acceptance.md](docs/cms-acceptance.md)。Docker 中处理合并冲突需要在 `.env` 配置 `CURSOR_API_KEY`。

页面管理支持搜索、分类、语言和状态筛选，并允许选择单个或多个页面发布。编辑器提供内容目录、右侧属性抽屉、图片上传替换、内容区域复制排序、设备样式、Guide 和隔离体验。发布前列出本次页面及网站共用设置变化；未选页面继续使用线上版本。共享编辑版本的保存与发布均检查内容版本。

网站管理和编辑操作见 [后台操作说明](docs/admin.md)。设计见 [网站管理与可视化编辑设计](docs/superpowers/specs/2026-10-26-site-admin-visual-editor-design.md)，实施步骤见 [实施计划](docs/superpowers/plans/2026-10-26-site-admin-visual-editor.md)。

生成、改写和翻译使用服务端配置的 MiniMax-M3，保存任务进度、知识来源和模型信息。本地 llm-wiki 支持从指定 Markdown 目录导入知识库。访客功能包含地图、WhatsApp、行为采集和询盘；多语言页面提供语言关联及 SEO。询盘邮件使用 SMTP 后台任务，Google Ads / GA 使用 OAuth 授权并查询账户数据，报告结合页面与网站统计进行诊断，保存统计快照并提供改写入口。外部服务配置参见 `.env.example`。

协作模型说明见 [docs/site-collaboration.md](docs/site-collaboration.md)；草稿预览见 [services/api/docs/preview-access.md](services/api/docs/preview-access.md)。Legacy 库迁移步骤见 [docs/migration-rehearsal.md](docs/migration-rehearsal.md) 与 [services/api/docs/README.md](services/api/docs/README.md)。

## 测试

```bash
npm run test
npm run typecheck
npm run build
```

协作 API 验收（本地注册账号 + 草稿 push，需 API 与远端已启动且配置 REMOTE_SERVICE_URL / REMOTE_SERVICE_TOKEN）：

```bash
npm run mvp:check
# 可选：MVP_CHECK_ACCOUNT / MVP_CHECK_PASSWORD
```

浏览器联调（真实 API，无 mock fetch）：

```bash
npm run test:e2e -w @olps/admin
```

需已启动 `@olps/api`、`@olps/remote` 与 PostgreSQL；依赖未就绪时该命令会失败，不能当作验收通过。

管理后台单元测试在 jsdom 中运行，不 mock HTTP。

## 先读

1. [docs/overview.md](docs/overview.md)
2. [docs/site-collaboration.md](docs/site-collaboration.md)
3. [docs/admin.md](docs/admin.md)
4. [docs/migration-rehearsal.md](docs/migration-rehearsal.md)
5. [services/api/docs/README.md](services/api/docs/README.md)
6. [services/api/docs/preview-access.md](services/api/docs/preview-access.md)
7. [docs/packages.md](docs/packages.md)
