# @olps/domain

`@olps/domain` 提供 CMS 共用领域类型、19 个 sandbox JSON Schema 和统一验证接口。

## 验证接口

```ts
import {
  SchemaValidationError,
  assertValidSchema,
  validateSchema,
} from '@olps/domain'

const result = validateSchema('site-settings', value)
assertValidSchema('site-settings', value, 'source/site-settings.json')
```

`validateSchema` 返回 `valid` 和结构化错误数组。每条错误包含对象路径、Schema 路径和原始可读消息。`assertValidSchema` 在验证失败时抛出 `SchemaValidationError`，并保留可选文件路径。

`page-locale` 的职责相关地址规则通过验证上下文提供：

```ts
validateSchema('page-locale', value, { pageRole: 'home' })
```

## Schema

Schema 位于 `src/schemas/`，覆盖网站设置、发布设置、外观、插件配置、跳转、页面、内容类型、总列表页、分组、条目、媒体、固定文字、主题、插件、区块和 manifest。全部 Schema 使用 `https://olps.dev/schemas/v1/` 下的固定 `$id`。

## 命令

- `npm run build -w @olps/domain`
- `npm test -w @olps/domain`
