# 当前草稿整站预览 HTTP 接口

完整请求、响应和错误格式见 [API 规约](../../../docs/design/api-conventions.md) 第 10 节。

## 创建预览

`POST /api/drafts/:draftId/preview`

请求需要 `Authorization: Bearer <accessToken>`：

```json
{
  "locale": "en",
  "target": {
    "ref": "page",
    "id": "17fa1c4f-cf9e-44d4-aa77-5e8366a55097"
  },
  "returnPath": "/drafts/af999cf1-44d5-4931-8515-6c17f584bf68/pages/17fa1c4f-cf9e-44d4-aa77-5e8366a55097"
}
```

- `target` 省略时打开当前语言首页。
- API 构建当前草稿的全部页面、内容类型、分组和条目，包括 `draft` 状态对象。
- 站内链接指向同一 capability 下的地址。
- 构建失败时返回 400 `BUILD_FAILED`，不写入 `draft_preview_capabilities`。
- 成功后 capability 绑定当前 session、用户、草稿、返回路径和预览目录。
- 默认有效期由 `PREVIEW_CREDENTIAL_TTL_SECONDS` 控制，默认 900 秒。

成功响应：

```json
{
  "previewUrl": "/preview-access/2Zp7.../en/contact/",
  "expiresAt": "2026-11-20T03:00:00.000Z"
}
```

## 访问预览

`GET /preview-access/:token/*`

- 不需要 Bearer，HTML 和静态资源只携带 URL 中的 token。
- HTML 顶部注入 admin bar，左侧「返回后台」使用 capability 保存的 `returnPath`，右侧显示当前用户。
- 公开构建不含 admin bar。
- 响应头为 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`。
- token 无效、capability 过期、session 过期或用户失去草稿权限时返回 403。

## 预览询盘

`POST /api/preview-access/:token/inquiries`

- 保存为当前草稿的询盘，`source` 为 `preview`。
- 不发送通知、营销转化和第三方事件。
- capability 的会话与权限校验同预览读取。

## 构建说明

- `@olps/site-builder` 使用与公开发布相同的整站读取和渲染流程。
- 模式为 `preview`，允许草稿对象互相链接，不注入追踪配置。
- `publicSiteUrl` 使用 capability 根地址。
- 只有全部预览文件写入成功后才保存 capability。
- 每次预览对应请求时的草稿快照；后续编辑需要生成新的预览。
