# Sandbox 文件格式

本文件定义 sandbox 中由 OLPS 管理的 JSON 文件。所有示例都是合法 JSON；正式校验文件位于 `packages/domain/src/schemas/`。

## 1. 通用规则

- 每个受管 JSON 文件都含 `"schemaVersion": 1`。
- JSON 文件使用 UTF-8、LF 换行和两个空格缩进。
- 属性名使用 camelCase。
- 未声明的属性由 JSON Schema 的 `additionalProperties: false` 拒绝；自定义字段值和区块 `props` 除外。
- 路径使用 `/`，不能包含绝对路径、`.`、`..` 和反斜线。
- API 写文件时先在同目录写临时文件，再以原子重命名替换目标文件。
- 一个业务操作涉及多个文件时，全部校验通过后在同一个草稿写入锁和同一个 Git commit 中保存。

```ts
type SchemaVersion = 1
```

`domain-model.md` 中的文件类型在写入 JSON 时增加 `schemaVersion: SchemaVersion`。

## 2. 目录

```text
source/
  site-settings.json
  publish-config.json
  appearance.json
  plugins.json
  redirects.json
  pages/<pageId>/page.json
  pages/<pageId>/<locale>.json
  collections/<collectionId>.json
  collections/<collectionId>/index/<locale>.json
  collections/<collectionId>/groups/<groupId>/group.json
  collections/<collectionId>/groups/<groupId>/<locale>.json
  collections/<collectionId>/items/<itemId>/item.json
  collections/<collectionId>/items/<itemId>/<locale>.json
  media/<mediaId>.json
  i18n/<locale>.json
assets/uploads/
themes/<themeId>/
plugins/<pluginId>/
tools/site-verify.mjs
olps.manifest.json
```

## 3. `source/site-settings.json`

```json
{
  "schemaVersion": 1,
  "siteName": "Acme Manufacturing",
  "siteUrl": "https://www.example.com",
  "company": {
    "name": "Acme Manufacturing Ltd.",
    "address": "100 Industry Road",
    "phone": "+1-555-0100",
    "email": "sales@example.com"
  },
  "iconMediaId": "f8f961d5-5c66-4cb4-9632-f9f424667420",
  "socialLinks": [
    {
      "platform": "linkedin",
      "url": "https://www.linkedin.com/company/example"
    }
  ],
  "locales": [
    { "code": "en", "dir": "ltr" },
    { "code": "zh-CN", "dir": "ltr" }
  ],
  "defaultLocale": "en",
  "search": {
    "allowIndexing": true,
    "allowAiSearch": true,
    "allowAiTraining": false
  }
}
```

## 4. `source/publish-config.json`

该文件由管理 API 在预览或发布构建前生成。后台不能直接编辑，文件中不能出现访问令牌、密码或私钥。

```json
{
  "schemaVersion": 1,
  "siteId": "1f6a93e3-c058-4c98-b89c-a80a79ba4f11",
  "publicSiteUrl": "https://www.example.com",
  "publicApiBaseUrl": "https://api.example.com",
  "hostingBasePath": "/",
  "connectors": {
    "ga4": {
      "measurementId": "G-ABC123"
    },
    "googleAds": {
      "conversionId": "AW-123456",
      "conversionLabel": "AbCdEf"
    },
    "meta": {
      "pixelId": "123456789"
    }
  },
  "conversionSettings": {
    "submitInquiry": true,
    "qualifiedInquiry": true
  },
  "indexNowKey": "2f9d90a1aa414e60816a"
}
```

- `hostingBasePath` 以 `/` 开头并以 `/` 结尾。
- `connectors` 只保存浏览器可以公开读取的配置。
- 预览构建把 `publicSiteUrl` 改为 capability 根地址，`siteId` 保持原值。

## 5. `source/appearance.json`

```ts
type MenuItem =
  | {
      menuItemId: EntityId
      label: Record<LocaleCode, string>
      link: InternalLink
      children: MenuItem[]
    }
  | {
      menuItemId: EntityId
      label: Record<LocaleCode, string>
      link: ExternalLink
      children: MenuItem[]
    }

type AppearanceConfig = {
  schemaVersion: 1
  themeId: string
  themeSettings: Record<string, unknown>
  menus: Record<string, MenuItem[]>
}
```

```json
{
  "schemaVersion": 1,
  "themeId": "starter",
  "themeSettings": {
    "primaryColor": "#14532d",
    "logo": {
      "mediaId": "f8f961d5-5c66-4cb4-9632-f9f424667420"
    }
  },
  "menus": {
    "primary": [
      {
        "menuItemId": "771e711f-691f-456d-bfd4-a17c17be0c35",
        "label": {
          "en": "Products",
          "zh-CN": "产品"
        },
        "link": {
          "kind": "internal",
          "target": {
            "ref": "collection",
            "id": "100a11de-d15a-49fe-9796-50f6c78ef2f2"
          }
        },
        "children": []
      }
    ]
  }
}
```

- `themeSettings` 必须按当前主题 `theme.json.settings` 生成的 Schema 校验。
- `menus` 的键必须来自当前主题 `theme.json.menus[].id`。
- 菜单层级上限为三层。

## 6. `source/plugins.json`

```ts
type PluginConfig = {
  enabled: boolean
  permissionsAcceptedAt: IsoDateTime | null
  permissionsAcceptedBy: EntityId | null
  settings: Record<string, unknown>
}

type PluginsConfig = {
  schemaVersion: 1
  plugins: Record<string, PluginConfig>
}
```

```json
{
  "schemaVersion": 1,
  "plugins": {
    "inquiry-form": {
      "enabled": true,
      "permissionsAcceptedAt": "2026-11-20T02:30:00.000Z",
      "permissionsAcceptedBy": "f122480f-4fa4-4987-ae6b-e8528cc7dd83",
      "settings": {
        "notificationEmails": ["sales@example.com"],
        "requirePrivacyConsent": true
      }
    }
  }
}
```

- 普通设置按插件 `plugin.json.settings` 生成的 Schema 校验。
- `secret` 设置不写入该文件，保存在数据库 `plugin_secrets`。
- 启用权限列表变化后的插件时，必须重新确认权限。

## 7. `source/redirects.json`

```ts
type RedirectEntry = {
  redirectId: EntityId
  locale: LocaleCode
  from: string
  target: ContentRef
  createdAt: IsoDateTime
}
```

```json
{
  "schemaVersion": 1,
  "redirects": [
    {
      "redirectId": "097af029-491c-46bb-bfc0-a06ec7bb405b",
      "locale": "en",
      "from": "/en/old-contact/",
      "target": {
        "ref": "page",
        "id": "17fa1c4f-cf9e-44d4-aa77-5e8366a55097"
      },
      "createdAt": "2026-11-20T02:30:00.000Z"
    }
  ]
}
```

- `from` 必须是站内绝对路径，不能包含查询参数和片段。
- `target` 在构建时解析为当前地址。
- 新地址不能与任何 `from` 相同；跳转不能形成环。
- 修改 `slug` 时由 API 自动增加记录。恢复旧 `slug` 时移除占用该地址的跳转记录。

## 8. 页面文件

`source/pages/<pageId>/page.json`：

```json
{
  "schemaVersion": 1,
  "pageId": "17fa1c4f-cf9e-44d4-aa77-5e8366a55097",
  "role": "contact",
  "template": "page",
  "status": "published",
  "createdAt": "2026-11-20T02:30:00.000Z",
  "updatedAt": "2026-11-20T02:40:00.000Z"
}
```

`source/pages/<pageId>/en.json`：

```json
{
  "schemaVersion": 1,
  "locale": "en",
  "slug": "contact",
  "title": "Contact us",
  "summary": "Contact our sales team.",
  "cover": null,
  "seo": {
    "title": "Contact Acme Manufacturing",
    "description": "Send an inquiry to our sales team.",
    "ogImage": null
  },
  "blocks": [
    {
      "id": "72cf4d09-7450-40c3-9bdd-95ed937493a8",
      "type": "theme/hero",
      "props": {
        "heading": "Contact us"
      },
      "children": []
    },
    {
      "id": "8b8fd5e9-4e9e-4628-8322-4aa5421650bb",
      "type": "plugin/inquiry-form/form",
      "props": {},
      "children": []
    }
  ],
  "sourceHash": null,
  "updatedAt": "2026-11-20T02:40:00.000Z"
}
```

每个已启用语言都可以有一个语言文件。文件不存在表示该语言未翻译。

## 9. 内容类型定义

`source/collections/<collectionId>.json`：

```json
{
  "schemaVersion": 1,
  "collectionId": "100a11de-d15a-49fe-9796-50f6c78ef2f2",
  "name": "产品",
  "labels": {
    "en": "Products",
    "zh-CN": "产品"
  },
  "prefix": "products",
  "status": "published",
  "levels": [
    {
      "levelId": "c2705e84-909d-438a-adf2-a8ab5f819214",
      "name": "产品系列"
    },
    {
      "levelId": "d924e112-dfb4-45e2-8122-a6ec6576d2ca",
      "name": "产品分类"
    }
  ],
  "fields": [
    {
      "key": "model",
      "type": "text",
      "label": "型号",
      "translatable": false,
      "required": true
    },
    {
      "key": "gallery",
      "type": "mediaList",
      "label": "图集",
      "translatable": false,
      "required": false
    },
    {
      "key": "specifications",
      "type": "table",
      "label": "规格参数",
      "translatable": true,
      "required": false,
      "columns": [
        { "key": "name", "label": "参数", "type": "text" },
        { "key": "value", "label": "值", "type": "text" }
      ]
    }
  ],
  "structuredData": "Product",
  "feed": false,
  "createdAt": "2026-11-20T02:30:00.000Z",
  "updatedAt": "2026-11-20T02:40:00.000Z"
}
```

## 10. 总列表页

`source/collections/<collectionId>/index/en.json`：

```json
{
  "schemaVersion": 1,
  "locale": "en",
  "title": "Products",
  "summary": "Browse our product catalog.",
  "cover": null,
  "seo": {
    "title": "Products | Acme Manufacturing",
    "description": "Browse our product catalog.",
    "ogImage": null
  },
  "blocks": [
    {
      "id": "b452de2f-553f-4302-9187-17405ccd1a70",
      "type": "core/collection-list",
      "props": {
        "source": "current",
        "pageSize": 24,
        "sort": "manual"
      },
      "children": []
    }
  ],
  "sourceHash": null,
  "updatedAt": "2026-11-20T02:40:00.000Z"
}
```

`core/collection-list.props`：

```ts
type CollectionListProps = {
  source: 'current' | { groupId: EntityId }
  pageSize: number
  sort: 'manual' | 'publishedAtDesc' | 'titleAsc'
}
```

`pageSize` 范围为 1 到 100。

## 11. 分组文件

`source/collections/<collectionId>/groups/<groupId>/group.json`：

```json
{
  "schemaVersion": 1,
  "groupId": "482a0720-099e-4997-990e-182ed333c57a",
  "parentGroupId": null,
  "levelId": "c2705e84-909d-438a-adf2-a8ab5f819214",
  "order": 10,
  "status": "published",
  "createdAt": "2026-11-20T02:30:00.000Z",
  "updatedAt": "2026-11-20T02:40:00.000Z"
}
```

`source/collections/<collectionId>/groups/<groupId>/en.json`：

```json
{
  "schemaVersion": 1,
  "locale": "en",
  "slug": "stainless-steel",
  "title": "Stainless steel",
  "summary": "Stainless steel product families.",
  "cover": null,
  "seo": {
    "title": "Stainless steel products",
    "description": "Browse stainless steel products.",
    "ogImage": null
  },
  "blocks": [
    {
      "id": "d764ac44-9923-4aae-9056-93db2c72d3c7",
      "type": "core/collection-list",
      "props": {
        "source": "current",
        "pageSize": 24,
        "sort": "manual"
      },
      "children": []
    }
  ],
  "sourceHash": null,
  "updatedAt": "2026-11-20T02:40:00.000Z"
}
```

## 12. 条目文件

`source/collections/<collectionId>/items/<itemId>/item.json`：

```json
{
  "schemaVersion": 1,
  "itemId": "9576d304-bf33-441f-95d7-613366762fa0",
  "primaryGroupId": "9c017b91-dcba-405a-813c-564382f54fbf",
  "groupIds": [
    "9c017b91-dcba-405a-813c-564382f54fbf",
    "28acddaf-d7bd-4057-b25e-766a1e973a5f"
  ],
  "order": 10,
  "publishedAt": "2026-11-20T02:30:00.000Z",
  "status": "published",
  "fields": {
    "model": "ACME-100",
    "gallery": []
  },
  "createdAt": "2026-11-20T02:30:00.000Z",
  "updatedAt": "2026-11-20T02:40:00.000Z"
}
```

`source/collections/<collectionId>/items/<itemId>/en.json`：

```json
{
  "schemaVersion": 1,
  "locale": "en",
  "slug": "acme-100",
  "title": "ACME 100",
  "summary": "Stainless steel tube for industrial applications.",
  "cover": null,
  "seo": {
    "title": "ACME 100 stainless steel tube",
    "description": "Specifications and applications for ACME 100.",
    "ogImage": null
  },
  "blocks": [],
  "fields": {
    "specifications": [
      { "name": "Outer diameter", "value": "100 mm" }
    ]
  },
  "sourceHash": null,
  "updatedAt": "2026-11-20T02:40:00.000Z"
}
```

## 13. 媒体元数据

`source/media/<mediaId>.json`：

```json
{
  "schemaVersion": 1,
  "mediaId": "f8f961d5-5c66-4cb4-9632-f9f424667420",
  "path": "assets/uploads/2026/11/factory.webp",
  "mimeType": "image/webp",
  "size": 183402,
  "width": 1600,
  "height": 900,
  "title": {
    "en": "Acme factory",
    "zh-CN": "Acme 工厂"
  },
  "alt": {
    "en": "Exterior of the Acme factory",
    "zh-CN": "Acme 工厂外景"
  },
  "caption": {
    "en": "",
    "zh-CN": ""
  },
  "uploadedBy": "f122480f-4fa4-4987-ae6b-e8528cc7dd83",
  "uploadedAt": "2026-11-20T02:30:00.000Z",
  "updatedAt": "2026-11-20T02:30:00.000Z"
}
```

## 14. 固定文字

`source/i18n/<locale>.json` 保存用户覆盖值：

```json
{
  "schemaVersion": 1,
  "strings": {
    "theme:starter:read_more": "Read more",
    "plugin:inquiry-form:submit": "Send inquiry"
  }
}
```

键名格式固定为 `theme:<themeId>:<key>` 或 `plugin:<pluginId>:<key>`。查找顺序为用户覆盖值、包内对应语言；两处都没有时构建失败。

## 15. `olps.manifest.json`

```json
{
  "schemaVersion": 1,
  "verifyCommand": [
    "node",
    "tools/site-verify.mjs"
  ]
}
```

`buildCommand` 由管理 API 通过 `SyncBuildConfig` 提供，不能写入 sandbox。

## 16. Schema 文件

```text
packages/domain/src/schemas/
  site-settings.schema.json
  publish-config.schema.json
  appearance.schema.json
  plugins.schema.json
  redirects.schema.json
  page-meta.schema.json
  page-locale.schema.json
  collection.schema.json
  collection-index-locale.schema.json
  group-meta.schema.json
  group-locale.schema.json
  item-meta.schema.json
  item-locale.schema.json
  media.schema.json
  i18n.schema.json
  theme.schema.json
  plugin.schema.json
  section.schema.json
  manifest.schema.json
```

Schema 的 `$id` 使用 `https://olps.dev/schemas/v1/<name>.schema.json`。`schemaVersion` 变化时增加新目录和转换程序，不能直接改变已有版本的含义。
