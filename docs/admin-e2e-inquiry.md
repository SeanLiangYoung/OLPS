# Admin Playwright：真实 public 询盘 E2E

## 范围

文件 `apps/admin/e2e/public-inquiry.spec.ts` 共 4 条用例：

1. **通用站页**：Push 后从 `publicSiteUrl` 首页点击 `page.title` 链接进入，浏览器提交询盘。
2. **广告承接页**：首页点击 `${page.title} (${keyword})` 进入词路由，Guide「Go」到 CTA 后提交。
3. **通用站页离线重试**：离线时等待询盘 POST 的 `requestfailed`，无文档导航；恢复在线后 POST 201 且 Admin/API 可见。
4. **广告 CTA 离线重试**：同上，使用 ads-runtime 与「Send ads」。

访客 HTML 仅含 `data-olps-inquiry` 表单；运行时由 `@olps/site-builder` 注入 `inquiry-runtime.ts` / `ads-runtime.ts`。

## 环境

| 变量 | 默认 | 说明 |
|------|------|------|
| `OLPS_ADMIN_URL` | `http://127.0.0.1:5173` | Admin `baseURL` |
| `OLPS_API_URL` | `http://127.0.0.1:8787` | 管理 API 与 public 询盘基址（与 publish-config `publicApiBaseUrl` 一致） |

须同时运行 `@olps/api`、`@olps/remote`、PostgreSQL **专用 e2e 库**（禁止 `olps` 生产库与迁移快照库）。

## 执行

```bash
npm run test:e2e -w @olps/admin -- e2e/public-inquiry.spec.ts
npm run test:e2e -w @olps/admin -- --list
```

服务未启动时不得将失败当作业务 RED。

## 依赖行为

- Public：`POST /api/public/:siteId/inquiries?pageId=…`（api worktree `app.ts` + `collaboration-public.ts`）。
- 首页链接：`packages/site-builder` 的 `public-routes.ts` / `plan.ts` `buildIndexHtml`。
- 成功文案：`Submitted`（`inquiry-runtime.ts` / `ads-runtime.ts`）。
