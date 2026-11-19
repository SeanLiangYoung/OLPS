# Open Landing Page System

Open Landing Page System（OLPS）是一个 AI 原生的网站管理系统，基于 AI 生成网站 + 静态页面管理，旨在创造一个好用的 AI 原生 CMS 的同时，尽可能降低服务器的资源使用，并生成搜索引擎友好 + AI 搜索友好的网站。

后台结构参考 WordPress：页面、内容类型（新闻、产品、解决方案等树形内容）、媒体、外观（主题）、插件、营销集成、设置。使用本系统账号登录后选择 sandbox **工作草稿**，在草稿内用 AI 建站，在区块式可视化编辑器里修改，用 AI 修改与翻译；点击「发布网站」后，验证通过的版本推送到**独立远端服务**，同时可以上传到 FTP、SFTP、S3、阿里云 OSS、腾讯云 COS。网站产物是纯静态的 HTML、CSS、JS 与资源文件，任何 Web 服务器都可以直接提供。

用户可以拥有多个网站，每个网站和草稿可以有多个所有者。网站内置中文和英文，可以添加其他语言。

## 本地运行

```powershell
docker compose up -d
copy .env.example .env
npm ci
npm run build
```

管理 API（`@olps/api`）启动时会从**仓库根目录**加载 `.env`。AI 生成与修改页面需要在 `.env` 中填写 `AI_API_KEY`（默认使用 DeepSeek 官方接口 `AI_BASE_URL=https://api.deepseek.com` 与 `AI_MODEL=deepseek-v4-pro`，见 [docs/model-defaults.md](docs/model-defaults.md)）。远端服务（`@olps/remote`）**不**读取根目录 `.env`，须在启动远端的终端显式设置 `REMOTE_SERVICE_TOKEN`、`REMOTE_PUBLIC_BASE_URL`、`REMOTE_DATA_ROOT`（推荐绝对路径，见下方）。

在**仓库根目录**打开三个 PowerShell 终端。在每个终端分别定义根路径与共用 token（与 `.env` 中 `REMOTE_SERVICE_TOKEN` 一致）：

```powershell
$Root = (Get-Location).Path
$Token = 'olps-remote-dev-token'
```

**终端 1 — 远端**

```powershell
Set-Location $Root
$env:REMOTE_SERVICE_TOKEN = $Token
$env:REMOTE_PUBLIC_BASE_URL = 'http://127.0.0.1:8790'
$env:REMOTE_PORT = '8790'
$env:REMOTE_DATA_ROOT = Join-Path $Root '.intermediate\remote-data'
node (Join-Path $Root 'services\remote\dist\server.js')
```

开发时可将最后一行换为：

```powershell
npx tsx (Join-Path $Root 'services\remote\src\server.ts')
```

**终端 2 — 管理 API**

```powershell
Set-Location $Root
npm run dev -w @olps/api
```

须已存在根目录 `.env`，且其中 `REMOTE_SERVICE_URL=http://127.0.0.1:8790` 与 `REMOTE_SERVICE_TOKEN` 和终端 1 相同。

**终端 3 — 管理后台**

```powershell
Set-Location $Root
npm run dev -w @olps/admin
```

浏览器打开 `http://127.0.0.1:5173`：注册或登录本系统账号 → 在「我的网站」创建或选择草稿 → AI 建站、可视化编辑、配置外观与插件、发布网站。

协作模型说明见 [docs/site-collaboration.md](docs/site-collaboration.md)；草稿预览见 [services/api/docs/preview-access.md](services/api/docs/preview-access.md)。Legacy 库迁移步骤见 [docs/migration-rehearsal.md](docs/migration-rehearsal.md) 与 [services/api/docs/README.md](services/api/docs/README.md)。

## 测试

```bash
npm run test
npm run typecheck
npm run build
```

`@olps/api` 的 AI 集成测试（`ai-page-jobs.integration.test.ts` 等）真实调用 `.env` 中配置的模型接口，缺少 `AI_API_KEY` 时失败。

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
2. [docs/plans/2026-11-19-wp-style-cms-implementation.md](docs/plans/2026-11-19-wp-style-cms-implementation.md)
3. [docs/site-collaboration.md](docs/site-collaboration.md)
4. [docs/admin.md](docs/admin.md)
5. [docs/migration-rehearsal.md](docs/migration-rehearsal.md)
6. [services/api/docs/README.md](services/api/docs/README.md)
7. [services/api/docs/preview-access.md](services/api/docs/preview-access.md)
8. [docs/packages.md](docs/packages.md)
