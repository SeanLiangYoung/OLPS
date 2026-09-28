# Open Landing Page System

网站内容管理系统：使用本系统账号登录后选择 sandbox **工作草稿**，在草稿内编辑页面；通过 Git 双向同步将验证通过的版本推送到**独立远端服务**，访客通过浏览器访问网站。

用户可以拥有多个网站，每个网站和草稿可以有多个所有者。

## 本地运行

```powershell
docker compose up -d
copy .env.example .env
npm ci
npm run build
```

管理 API（`@olps/api`）启动时会从**仓库根目录**加载 `.env`。远端服务（`@olps/remote`）**不**读取根目录 `.env`，须在启动远端的终端显式设置 `REMOTE_SERVICE_TOKEN`、`REMOTE_PUBLIC_BASE_URL`、`REMOTE_DATA_ROOT`（推荐绝对路径，见下方）。

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

浏览器打开 `http://127.0.0.1:5173`：注册或登录本系统账号 → 在工作区创建或选择草稿 → 编辑、生成、Pull/Push 协作。

Legacy PostgreSQL 库迁移见 [docs/migration-rehearsal.md](docs/migration-rehearsal.md) 与 [services/api/docs/README.md](services/api/docs/README.md)。

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
6. [docs/packages.md](docs/packages.md)
