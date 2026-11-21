# 媒体、外观、主题与插件接口

以下地址以 `/api` 为前缀，需要 `Authorization: Bearer <accessToken>` 和对应草稿的成员权限。读取结果中的 `revision` 用于后续编辑，请求头格式为 `If-Match: "sha256:..."`。摘要变化返回 409，内容检查失败返回 400，权限不足返回 403，资源不存在返回 404。响应保留 `code` 与 `details`，供界面展示使用情况和修改影响。

## 媒体

- `GET /drafts/:draftId/media` 返回 `{media:[{media,revision}]}`。
- `POST /drafts/:draftId/media` 接收 multipart 字段 `file`，返回 `{media,revision}`，状态为 201。
- `GET /drafts/:draftId/media/:mediaId` 读取媒体资料与摘要。
- `PUT /drafts/:draftId/media/:mediaId` 接收 `{title?,alt?,caption?}`；这些属性均为语言代码到文字的映射，需要 `If-Match`。
- `POST /drafts/:draftId/media/:mediaId/replace` 接收 multipart 字段 `file` 和 `If-Match`，替换文件并保留媒体标识。上传时间更新，资料修改时间保持原值；标题、替代文本和说明通过资料编辑接口修改。
- `GET /drafts/:draftId/media/:mediaId/usages` 返回 `{usages:[{path,field}]}`，位置来自实际内容引用。
- `DELETE /drafts/:draftId/media/:mediaId` 需要 `If-Match`；仍有引用时返回 409，成功返回 204。
- `GET /drafts/:draftId/media/:mediaId/file` 返回经过权限检查的文件，附带媒体类型和内容安全策略。

文件允许 PNG、JPEG、WebP、GIF、SVG、MP4、WebM 和 PDF；实际内容类型需要与扩展名一致。SVG 经过清理，图片经过实际解码和尺寸检查。上传大小由 `MEDIA_MAX_BYTES` 控制，默认 20 MiB。

## 主题与外观

- `GET /drafts/:draftId/themes` 返回 `{themes:[{manifest,active}],revision}`。
- `POST /drafts/:draftId/themes` 接收 multipart 压缩包字段 `file`，返回 `{id,version,previousVersion,permissionsChanged}`。
- `POST /drafts/:draftId/themes/:themeId/activate` 接收 `{confirmImpact?:boolean}` 和 `If-Match`。已有内容使用新主题未提供的区块时返回 `THEME_CHANGE_REQUIRES_CONFIRMATION`，`details.usages` 列出影响位置；明确确认后完成切换。
- `DELETE /drafts/:draftId/themes/:themeId` 需要 `If-Match`，当前主题不能删除，成功返回 204。
- `GET /drafts/:draftId/themes/:themeId/files/*` 返回该主题允许读取的文件，访问范围限制在对应主题目录。
- `GET /drafts/:draftId/appearance` 返回 `{appearance,revision}`。
- `PUT /drafts/:draftId/appearance` 接收完整 `appearance` 对象和 `If-Match`，保存主题设置与多语言菜单。主题切换使用主题启用接口。
- `GET /drafts/:draftId/i18n/:locale` 返回 `{i18n:{schemaVersion,strings},revision}`；文字包含包中当前语言的默认文字与网站覆盖值。
- `PUT /drafts/:draftId/i18n/:locale` 接收 `{schemaVersion:1,strings}` 和 `If-Match`。键名格式为 `theme:<themeId>:<key>` 或 `plugin:<pluginId>:<key>`。

## 插件

- `GET /drafts/:draftId/plugins` 返回 `{plugins:[{manifest,config}],revision}`。
- `POST /drafts/:draftId/plugins` 接收 multipart 压缩包字段 `file`，返回安装结果。服务器权限变化会停用插件并清除权限确认，需要所有者重新确认。
- `PUT /drafts/:draftId/plugins/:pluginId` 接收 `{enabled,confirmPermissions?}` 和 `If-Match`。服务器插件首次启用需要网站所有者确认，返回 `{enabled,permissions,usages,revision}`。
- `GET /drafts/:draftId/plugins/:pluginId/settings` 返回 `{enabled,settings,secrets,revision,permissions}`；`secrets` 只表示哪些密钥已经配置，不包含密钥内容。
- `PUT /drafts/:draftId/plugins/:pluginId/settings` 接收 `{settings,secrets?}` 和 `If-Match`，返回 `{settings,secrets,revision}`。`secrets` 中的字符串更新对应密钥，`null` 清除密钥，省略时保留原值。
- `GET /drafts/:draftId/plugins/:pluginId/logs` 返回 `{logs}`。
- `DELETE /drafts/:draftId/plugins/:pluginId` 需要 `If-Match`，成功返回 204。内置插件、已启用插件以及仍有内容引用的插件不能删除。

设置按插件声明的字段类型通过 Schema 检查；`translatable` 字段可以保存已启用语言的值，例如 `{buttonLabel:{en:"Contact","zh-CN":"联系我们"}}`。未知语言和错误类型会被拒绝。密钥加密保存，客户端渲染上下文只包含普通设置。

## 网站设置与语言

- `GET /drafts/:draftId/settings` 返回 `{settings,revision}`。
- `PUT /drafts/:draftId/settings` 接收 `{settings}` 和 `If-Match`，用于保存普通网站设置。该接口在草稿锁和摘要检查后比较语言清单；变更 `locales` 返回 400 `VALIDATION_FAILED`，文件和摘要保持原值。新增语言使用下面的语言接口。
- `POST /drafts/:draftId/locales` 接收 `{code,dir}` 和 `If-Match`，其中 `dir` 为 `ltr` 或 `rtl`，返回 `{created,settings,revision}`。

添加语言时，事务建立全部角色页面、内容列表、分组、条目的语言副本与查询索引，并补充主题和插件语言文件、固定文字和菜单标签。新内容的 `sourceHash` 为 `null`，表示需要翻译；任意步骤失败时，文件和数据库保持一致。
