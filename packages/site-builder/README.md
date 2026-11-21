# @olps/site-builder

将 CMS sandbox 构建为访客可用的 `public/` 静态站点：读取 `SiteModel`、执行 build-checks、运行插件 `onBuild` / `transformHtml`、处理图片多尺寸与 WebP、打包主题与插件 CSS/JS（文件名含内容哈希），并渲染全部已发布语言的公开 HTML。

## 命令

```bash
npm run build -w @olps/site-builder
npm run test -w @olps/site-builder
```

## 构建顺序

1. 读取 sandbox，构造 `SiteModel`，执行 `build-checks`
2. 执行插件 `onBuild`
3. 处理图片，打包 CSS 与 JS，复制媒体与静态资源
4. 渲染全部公开路由的已发布语言版本，执行 `transformHtml`
5. 生成 Pagefind 搜索、网站地图、Feed、robots、AI 访问说明、Markdown、图标、404 和跳转文件
6. 写入 `public/` 与 `server-config/`，安装独立验证器并记录源码和产物摘要

`buildPreview(workspacePath, { outputDirectory })` 构建全部草稿内容。预览使用独立输出目录，保留主题与插件运行效果，关闭营销追踪。

## CLI

管理进程使用本包的 `cli` 导出，在 sandbox 根目录运行构建。发布版本携带 `tools/site-verify.mjs`，可以独立检查源码、产物、摘要和站内引用：

```bash
node tools/site-verify.mjs
```

`installSiteBuilder(workspacePath)` 安装独立验证器并在 `olps.manifest.json` 中设置 `verifyCommand`。`classifyAssetsOnly` 比较源码与媒体变更，`buildAssetsOnly` 生成符合资源专用发布规则的产物。
