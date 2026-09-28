# @olps/site-builder

将 CMS sandbox 中的 `source/pages/*.json` 与根目录 `assets/` 构建为访客可用的 `public/` 静态站点（HTML、SEO、广告关键词页、询盘脚本、sitemap）。

## 命令

```bash
npm run build -w @olps/site-builder
npm run test -w @olps/site-builder
```

## Sandbox 布局

见主仓库 `.intermediate/coordination/builder-api.md`。

## CLI

打包结果：`dist/site-build.mjs`。在 sandbox 根目录执行：

```bash
node tools/site-build.mjs          # 构建
node tools/site-build.mjs --verify # 校验产物
```

`installSiteBuilder(workspacePath)` 会把该文件安装到 `tools/site-build.mjs` 并更新 `olps.manifest.json`。
