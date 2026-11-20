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
5. 写入 `public/`

隐藏文件、404、跳转、Pagefind、`site-verify` 扩展由后续 Task 完成。

## CLI

打包结果：`dist/site-build.mjs`。在 sandbox 根目录执行：

```bash
node tools/site-build.mjs
node tools/site-build.mjs --verify
```

`installSiteBuilder(workspacePath)` 会把该文件安装到 `tools/site-build.mjs` 并更新 `olps.manifest.json`。
