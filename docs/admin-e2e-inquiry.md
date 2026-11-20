# Admin Playwright：真实 public 询盘 E2E

## 范围

文件 `apps/admin/e2e/public-inquiry.spec.ts` 覆盖：

1. **公开网站**：发布后从 `publicUrl` 首页进入联系页面，通过 `plugin/inquiry-form/form` 提交询盘；API 返回 201，后台按 `siteId` 可见。
2. **公开网站离线重试**：离线时请求失败且页面不跳转；恢复网络后使用同一个 `eventId` 重试，API 只创建一条询盘。
3. **当前草稿预览**：从后台打开整站预览，提交表单到 `/api/preview-access/:token/inquiries`；后台筛选 `source=preview` 后可见，邮件与营销发送记录为空。

询盘表单由内置插件提供，构建时根据 `publish` 或 `preview` 模式写入对应接口地址。

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

- 公开接口：`POST /api/public/:siteId/inquiries`，请求体含 `target`、`locale`、`formId`、`fields`、`privacyConsent`、`attribution` 与 `eventId`。
- 预览接口：`POST /api/preview-access/:token/inquiries`。
- 页面与相对链接由 `@olps/render` 和 `@olps/site-builder` 生成。
- 成功后跳转到当前语言的 `thank-you` 职责页面。
