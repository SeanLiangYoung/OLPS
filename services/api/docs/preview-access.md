# 草稿预览 HTTP 接口

## 创建预览

`POST /api/drafts/:draftId/pages/:pageId/preview`

- 需要 `Authorization: Bearer <accessToken>`。
- 依赖 sandbox 内 `source/publish-config.json` 存在且为合法 JSON；缺失或损坏返回 **400**，不写入 `draft_preview_capabilities`。
- 成功响应：`{ "previewUrl": "/preview-access/<token>/<entryRoute>/" }`。
- capability 绑定当前 session 与草稿所有权；默认有效期由环境变量 `PREVIEW_CREDENTIAL_TTL_SECONDS` 控制（默认 900 秒）。

## 访问预览

`GET /preview-access/:token/*`

- 不需要 Bearer；iframe 与静态资源仅携带 URL 中的 token。
- 响应头：`Cache-Control: no-store`、`Referrer-Policy: no-referrer`。
- 拒绝条件：token 无效、capability 过期、**session 已过期**、用户已失去草稿所有权。
- 旧路径 `GET /preview/:draftId/:pageId/*` 返回 **403**。

## 构建说明

预览 HTML 与静态资源由 `@olps/site-builder` 的 `computeBuildPlan` 生成，并复制 sandbox 根目录 `assets/**`。

- `publicSiteUrl` 设为 `{publicApiBaseUrl}/preview-access/{token}`（不含 `s/pv`），由 builder 生成 **canonical** 与页面路径：`/preview-access/{token}/{slug}/`。
- 写入磁盘后，对 HTML 使用 site-builder 的 `rewriteSiteAssetReferences`（parse5），将 `/assets/` 等引用改写为 `/preview-access/{token}/s/pv/...`，与 capability 静态目录 `s/pv` 一致。
- 广告页运行时脚本路径同样带上述前缀，便于无 Bearer 加载。
