# @olps/domain

`@olps/domain` 提供 CMS 共用领域类型、19 个 sandbox JSON Schema、统一验证接口，以及新建网站的默认内容定义。

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

## 默认网站内容

```ts
import {
  collectionPresets,
  createDefaultSiteContent,
  defaultManagedSiteSettings,
  requiredPages,
  validateSiteContent,
} from '@olps/domain'

const content = createDefaultSiteContent()
const result = validateSiteContent(content)
```

- `requiredPages`：八个必备页面的 `role`、名称、默认 `slug`、`noindex`、是否进入 sitemap。
- `collectionPresets`：新闻、产品、解决方案三个内容类型预设。
- `defaultManagedSiteSettings`：`ManagedSiteSettings` 默认值（`en` + `zh-CN`，`defaultLocale=en`，`allowAiTraining=false`）。
- `createDefaultSiteContent`：生成可复现的完整默认内容（16 个页面语言文件、3 个内容类型、`starter` 外观、三个内置插件启用）。
- `validateSiteContent`：检查必备页面语言文件、内容类型、角色唯一性、默认语言和站内引用。
- `validateCollectionFields`：根据内容类型定义校验共用与语言字段，覆盖十一种字段类型、必填值、选项、日期、表格列和引用结构，返回 AJV 问题清单。目标条目所属内容类型由 API 在同一保存事务中检查。

## Schema

Schema 位于 `src/schemas/`，覆盖网站设置、发布设置、外观、插件配置、跳转、页面、内容类型、总列表页、分组、条目、媒体、固定文字、主题、插件、区块和 manifest。全部 Schema 使用 `https://olps.dev/schemas/v1/` 下的固定 `$id`。

## 命令

- `npm run build -w @olps/domain`
- `npm test -w @olps/domain`
