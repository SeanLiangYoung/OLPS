# Admin Playwright：真实 public 询盘 E2E

## 范围

文件 `apps/admin/e2e/public-inquiry.spec.ts` 覆盖：

1. **通用站页**（`kind=site`）：草稿内编辑含 `data-olps-inquiry` 的 HTML，Push 到远端，访客页浏览器提交，断言 POST JSON 与 `pageId` 查询参数，Admin 询盘列表与 `GET /api/sites/:siteId/inquiries` 一致。
2. **广告承接页**（`kind=ads`）：最小 Guide 图 + CTA 表单，Push 后从关键词落地 URL 进入 CTA，浏览器提交同上。
3. **离线**：`browserContext.setOffline(true)` 下提交失败且 **URL 不变**（无默认表单导航）；恢复在线后再次提交成功，且离线那条 payload 未入库。

辅助逻辑在 `apps/admin/e2e/inquiry-helpers.ts`。测试准备允许通过 Admin 会话 token 发真实 `PATCH` 写页面 body；**询盘提交必须在 Playwright 控制的访客页完成**，禁止 mock、route 拦截或假 fetch。

## 环境

| 变量 | 默认 | 说明 |
|------|------|------|
| `OLPS_ADMIN_URL` | `http://127.0.0.1:5173` | Admin `baseURL` |
| `OLPS_API_URL` | `http://127.0.0.1:8787` | 管理 API；`requireApiReady` 访问 `/api/health` |

须同时运行：

- `@olps/api`（管理 API + `/p/` 静态发布，视部署而定）
- `@olps/remote`（Push 目标与 `publicUrl` 访客 HTTP）
- PostgreSQL：**专用 e2e 库**（禁止 `olps` 生产库与迁移快照库）

`playwright.config.ts` 已关闭 trace、screenshot、video。

## 执行

```bash
npm run test:e2e -w @olps/admin -- e2e/public-inquiry.spec.ts
```

仅收集用例（不连服务）：

```bash
npm run test:e2e -w @olps/admin -- --list
```

服务未启动时 **不得** 将失败当作业务 RED；由主控在环境就绪后跑 RED/GREEN。

## 依赖 API 行为（当前代码预期）

- `POST /api/public/:tenantId/:siteId/inquiries?pageId=…`，body 为表单字段 JSON。
- Push 后草稿关联 `siteId`；询盘 Admin 列表走 `GET /api/sites/:siteId/inquiries`。
- 广告页发布注入 `services/api` 的 `adsRuntimeScript`，CTA 屏含 `data-olps-inquiry`。

主仓库 `packages/site-builder` 若后续提供站页询盘脚本，站页 fixture HTML 应对齐其访客提交语义（`preventDefault` + `fetch` POST）。
