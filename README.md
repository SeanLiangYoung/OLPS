# Open Landing Page System

网站内容管理系统：使用本系统账号登录后选择 sandbox **工作草稿**，在草稿内编辑页面；通过 Git 双向同步将验证通过的版本推送到**独立远端服务**，访客通过浏览器访问网站。

用户可以拥有多个网站，每个网站和草稿可以有多个所有者。

## 本地运行

```bash
docker compose up -d
copy .env.example .env
# 编辑 .env：DATABASE_URL、REMOTE_SERVICE_URL、REMOTE_SERVICE_TOKEN 等
npm ci
npm run build
```

三个进程分别启动（三个终端；`.env` 中 `REMOTE_SERVICE_*` 须与远端一致）：

```bash
npm run dev -w @olps/remote
npm run dev -w @olps/api
npm run dev -w @olps/admin
```

浏览器打开 `http://127.0.0.1:5173`：注册或登录本系统账号 → 在工作区创建或选择草稿 → 编辑、生成、Pull/Push 协作。

Legacy PostgreSQL 库迁移（本地账号、所有权映射、bootstrap CLI、启动 API 触发迁移）见 [docs/migration-rehearsal.md](docs/migration-rehearsal.md) 与 [services/api/docs/README.md](services/api/docs/README.md)。管理 API 日常说明以 `services/api/docs` 为准。

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
4. [docs/migration-rehearsal.md](docs/migration-rehearsal.md)（legacy 库迁移步骤；生产库是否已迁移以实际为准）
5. [services/api/docs/README.md](services/api/docs/README.md)
6. [docs/packages.md](docs/packages.md)
