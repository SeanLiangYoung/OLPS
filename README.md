# Open Landing Page System

Open Landing Page System（OLPS）是一个 AI 原生的网站管理系统，基于 AI 生成网站 + 静态页面管理，旨在创造一个好用的 AI 原生 CMS 的同时，尽可能降低服务器的资源使用，并生成搜索引擎友好 + AI 搜索友好的网站。

后台提供页面、新闻与产品等内容类型、分组树、媒体、主题、插件、营销连接和设置。登录后创建或选择网站及编辑版本，在区块式可视化编辑器中维护内容，也可以使用 AI 生成、修改和翻译。发布时完成构建与校验，将同一版本发送到独立远端服务和启用的 FTP、FTPS、SFTP、S3、阿里云 OSS、腾讯云 COS 目标。访客网站由静态 HTML、CSS、JavaScript 与资源文件组成。

用户可以拥有多个网站，每个网站和草稿可以有多个所有者。网站内置中文和英文，可以添加其他语言。

## 本地运行

需要 Node.js 24 或更新版本、npm、Git 和 PostgreSQL。`isolated-vm` 使用原生模块，安装环境需要 Python 和 C++ 编译工具；Windows 使用 Visual Studio Build Tools，macOS 使用 Xcode Command Line Tools。合并冲突处理需要可用的 Cursor Agent。

```powershell
docker compose up -d
copy .env.example .env
npm ci
npm run build
```

管理 API（`@olps/api`）启动时从仓库根目录加载 `.env`。必须配置 `CREDENTIALS_ENCRYPTION_KEY`，内容为32字节随机值的 Base64 编码；密钥需要稳定保存，现有加密凭据依赖该密钥。AI 使用 `AI_API_KEY`、`AI_BASE_URL` 和 `AI_MODEL`，默认模型配置见 [docs/model-defaults.md](docs/model-defaults.md)。Google、Meta 和邮件通知的环境变量列在 `.env.example`。远端服务（`@olps/remote`）由启动终端提供 `REMOTE_SERVICE_TOKEN`、`REMOTE_PUBLIC_BASE_URL`、`REMOTE_DATA_ROOT`。

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

浏览器打开 `http://127.0.0.1:5173`：注册或登录 → 在「我的网站」创建或选择网站 → 编辑内容、配置外观与插件 → 预览和发布。

协作模型说明见 [docs/site-collaboration.md](docs/site-collaboration.md)；草稿预览见 [services/api/docs/preview-access.md](services/api/docs/preview-access.md)。Legacy 库迁移步骤见 [docs/migration-rehearsal.md](docs/migration-rehearsal.md) 与 [services/api/docs/README.md](services/api/docs/README.md)。

## 测试

本次实现与验证记录见 [CMS 集成验收](docs/validation/2026-11-21-cms.md)，实际部署结果见 [静态部署验收](docs/static-deployment-rehearsal.md)。

首次运行测试前创建专用数据库、安装 Chromium，并完成 Cursor Agent 登录。Docker 需要保持运行，以启动真实 OpenSSH 和 S3 测试服务：

```bash
docker compose exec postgres createdb -U olps olps_test_api
npx playwright install chromium
```

```bash
npm run test
npm run typecheck
npm run build
npm run test:docs
npm run check:docs
npm run static:check
```

默认测试使用真实 PostgreSQL、Git、HTTP、浏览器、SMTP 和本地文件传输服务。AI 测试在配置密钥时调用真实模型；缺少密钥时检查任务失败状态与内容保护。真实模型成功、Google/Meta 授权与转化、云端发布目标和生产迁移需要独立完成外部验收。

完整业务验收需要已启动的管理 API、远端、真实模型、授权账户及部署目标，配置说明见 [主流程验收](docs/flows/mvp-happy-path.md)：

```bash
npm run mvp:check
```

浏览器联调（真实 API，无 mock fetch）：

```bash
npm run test:e2e -w @olps/admin
```

需已启动 `@olps/api`、`@olps/remote` 与 PostgreSQL；依赖未就绪时该命令会失败，不能当作验收通过。

管理后台组件测试与真实 Chromium 操作测试共同验证编辑与管理流程。

## 先读

1. [docs/overview.md](docs/overview.md)
2. [docs/plans/2026-11-19-wp-style-cms-implementation.md](docs/plans/2026-11-19-wp-style-cms-implementation.md)
3. [docs/site-collaboration.md](docs/site-collaboration.md)
4. [docs/admin.md](docs/admin.md)
5. [docs/migration-rehearsal.md](docs/migration-rehearsal.md)
6. [services/api/docs/README.md](services/api/docs/README.md)
7. [services/api/docs/preview-access.md](services/api/docs/preview-access.md)
8. [docs/packages.md](docs/packages.md)
