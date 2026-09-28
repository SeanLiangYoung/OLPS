# Open Landing Page System

落地页特化 CMS：本系统账号登录后选择 sandbox **工作草稿**，在草稿内编辑页面；通过 Git 双向同步将验证通过的版本推送到**独立远端服务**并在浏览器提供线上访问。

本仓库**独立**，不依赖 `landing-page-system` 的代码或包路径。

## 本地运行

```bash
docker compose up -d
copy .env.example .env
# 编辑 .env：数据库连接等（见 services/api 文档）
npm ci
npm run build -w @olps/domain
```

三个进程分别启动（三个终端）：

```bash
npm run dev -w @olps/api
npm run dev -w @olps/remote
npm run dev -w @olps/admin
```

浏览器打开 `http://127.0.0.1:5173`：注册或登录本系统账号 → 在工作区创建或选择草稿 → 编辑、生成、Pull/Push 协作。

## 测试

```bash
npm run test -w @olps/admin
npm run typecheck -w @olps/admin
npm run build -w @olps/admin
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
4. [docs/packages.md](docs/packages.md)
