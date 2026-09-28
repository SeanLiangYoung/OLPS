# Admin Playwright：真实 public 询盘 E2E

## 范围

文件 `apps/admin/e2e/public-inquiry.spec.ts` 覆盖：

1. **通用站页**（`kind=site`）：草稿内写入仅含 `data-olps-inquiry` 的 HTML（无自写 script），Push 后 `@olps/site-builder` 注入 `inquiry-runtime.ts`；访客浏览器提交，断言 POST 指向 `POST /api/public/:siteId/inquiries?pageId=…` 与 JSON body，Admin 与 `GET /api/sites/:siteId/inquiries` 一致。
2. **广告承接页**（`kind=ads`）：CTA 屏表单 + Push 后 builder 注入 `ads-runtime.ts`；落地 URL 取自 Push 后页面 `publicUrls`，Guide 按钮文案与 builder 一致（`Go` → CTA，`Send ads` 提交）。
3. **离线**：`browserContext.setOffline(true)` 下提交不会出现运行时成功文案 `Submitted`，且 URL 不变；恢复在线后再次提交出现 `Submitted` 并入库。

辅助逻辑在 `apps/admin/e2e/inquiry-helpers.ts`。测试准备允许通过 Admin 会话 token 发真实 `PATCH` 写页面 body；**询盘提交必须在 Playwright 控制的访客页完成**。禁止 mock、route 拦截、假 fetch、自建 submit 脚本。

## 环境

| 变量 | 默认 | 说明 |
|------|------|------|
| `OLPS_ADMIN_URL` | `http://127.0.0.1:5173` | Admin `baseURL` |
| `OLPS_API_URL` | `http://127.0.0.1:8787` | 管理 API 与 public 询盘 API 基址（与 publish-config `publicApiBaseUrl` 一致） |

须同时运行：

- `@olps/api`（含 `POST /api/public/:siteId/inquiries`）
- `@olps/remote`（Push 与 `publicUrl` / 页面 `publicUrls`）
- PostgreSQL：**专用 e2e 库**（禁止 `olps` 生产库与迁移快照库）

`playwright.config.ts` 已关闭 trace、screenshot、video。

## 执行

```bash
npm run test:e2e -w @olps/admin -- e2e/public-inquiry.spec.ts
```

仅收集用例：

```bash
npm run test:e2e -w @olps/admin -- --list
```

服务未启动时 **不得** 将失败当作业务 RED；由主控在环境就绪后跑 RED/GREEN。

## 依赖行为（api worktree + site-builder）

- Public：`POST /api/public/:siteId/inquiries?pageId=…`，body 为表单字段 JSON（见 `collaboration-public.ts`）。
- 发布 HTML：`packages/site-builder` 的 `inquiry-runtime.ts` / `ads-runtime.ts` 绑定 `[data-olps-inquiry]`，成功时 `[data-olps-inquiry-status]` 文案为 `Submitted`。
- 访客 URL：Push 后 `GET /api/drafts/:draftId/pages/:pageId` 的 `publicUrls`，勿在测试中手写 slugify 或 tenant 路径。
