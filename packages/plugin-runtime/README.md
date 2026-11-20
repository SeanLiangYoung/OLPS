# `@olps/plugin-runtime`

用真实 `isolated-vm` 执行插件服务器代码。

## 能力

- `runOnBuild` / `runTransformHtml`：构建钩子；全部钩子共享 60 秒预算；`onBuild` 产物路径限制在 `public/plugins/<pluginId>/`
- `runPluginApi`：执行 `handle`；单次 5 秒
- `compilePluginServerScripts`：安装时检查 `server/*.js` 可编译
- 每次调用新建 128 MB isolate；按 `permissions` 注入 `ctx.settings`、`ctx.store`、`ctx.fetch`、`ctx.inquiries.create`、`ctx.log`

## 测试

`test-fixtures/plugins/*` 提供真实插件脚本。`npm test` 使用真实 isolate，不使用 mock。
