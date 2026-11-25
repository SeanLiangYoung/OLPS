# Knowledge Agent Skill 说明

面向编码代理：经 knowledge 服务的 **MCP** 与 **HTTP API** 操作某一 `siteId` 的知识库。设计见 [design/knowledge-service.md](design/knowledge-service.md) §2.3–§2.4；计划见 [plans/2026-11-25-knowledge-service-wave-plan.md](plans/2026-11-25-knowledge-service-wave-plan.md) §W5-T2；验收见 [validation/knowledge-service-acceptance.md](validation/knowledge-service-acceptance.md)。

## 边界

- Skill **只**通过 MCP 工具或 knowledge HTTP 调用已实现能力。
- **禁止**在 Skill / 代理侧再实现一套 zip 解压、文档文本抽取、Wiki 解析或素材角色识别。解析与 Ingest 全部由 `@olps/knowledge` 进程完成。
- 首期 MCP **不提供** `chat` / `graph` / `embed` 类工具。

## 前置：启动 knowledge HTTP

MCP 与 HTTP 客户端都依赖已运行的 knowledge 服务。在仓库根目录：

1. 配置环境变量（与服务进程共用同一令牌）：
   - `KNOWLEDGE_SERVICE_TOKEN`：非空服务间令牌（HTTP `Authorization: Bearer …`）
   - `KNOWLEDGE_ROOT`：可选，默认 `.intermediate/knowledge-data`
   - `KNOWLEDGE_PORT`：可选，默认 `19828`
   - `KNOWLEDGE_HOST`：可选，默认 `127.0.0.1`
   - `DATABASE_URL`：需要投影写入（如 `pages/write`）时配置
2. 启动 HTTP：

```bash
npm run dev:knowledge
```

或构建后：

```bash
npm run start -w @olps/knowledge
```

默认监听 `http://127.0.0.1:19828`。可用 `GET /health` 确认存活。

## 安装 / 启用 MCP

在仓库根目录启动 stdio MCP（包脚本：`services/knowledge/package.json` 的 `mcp`）：

```bash
npm run mcp -w @olps/knowledge
```

MCP 进程**必须**设置：

| 环境变量 | 含义 |
|----------|------|
| `KNOWLEDGE_SERVICE_URL` | knowledge HTTP 根地址，例如 `http://127.0.0.1:19828` |
| `KNOWLEDGE_SERVICE_TOKEN` | 与 HTTP 服务相同的 Bearer 令牌 |

Cursor / 兼容 MCP 宿主示例（`cwd` 为仓库根）：

```json
{
  "mcpServers": {
    "olps-knowledge": {
      "command": "npm",
      "args": ["run", "mcp", "-w", "@olps/knowledge"],
      "env": {
        "KNOWLEDGE_SERVICE_URL": "http://127.0.0.1:19828",
        "KNOWLEDGE_SERVICE_TOKEN": "与 knowledge 进程相同的令牌"
      }
    }
  }
}
```

未启动 HTTP、URL 不可达时，工具返回明确失败信息（含连接错误）。令牌缺失时 MCP 进程启动即退出。

实现目录：`services/knowledge/src/mcp-server/`。

## 已实现的 `olps_knowledge_*` 工具

下列工具内部只转发 knowledge HTTP，无第二套业务逻辑：

| 工具名 | HTTP | 主要参数 |
|--------|------|----------|
| `olps_knowledge_status` | `GET /health` | （无） |
| `olps_knowledge_projects` | `GET /api/v1/projects` | （无） |
| `olps_knowledge_project` | `GET /api/v1/projects/:siteId` | `siteId` |
| `olps_knowledge_files` | `GET /api/v1/projects/:siteId/files` | `siteId`；可选 `prefix`（如 `wiki`、`raw/sources`） |
| `olps_knowledge_read_file` | `GET /api/v1/projects/:siteId/files/content` | `siteId`、`path` |
| `olps_knowledge_search` | `POST /api/v1/projects/:siteId/search` | `siteId`、`query`；可选 `role` |
| `olps_knowledge_reviews` | `GET /api/v1/projects/:siteId/reviews` | `siteId`；可选 `status` |
| `olps_knowledge_assets` | `GET /api/v1/projects/:siteId/assets` | `siteId`；可选 `role` |
| `olps_knowledge_write_page` | `POST /api/v1/projects/:siteId/pages/write` | `siteId`、`action`（`create`\|`update`\|`delete`）、`documentId`；`create`/`update` 时 `title`、`content` |

HTTP 路径全集见设计 [§2.3](design/knowledge-service.md#23-http-api-形状首期必做子集)。导入、resolve review、修正素材角色等尚无对应 MCP 工具时，使用下文 HTTP。

## 对某一 `siteId` 的操作步骤

以下假定 `siteId` 已知，且请求均带 `Authorization: Bearer <KNOWLEDGE_SERVICE_TOKEN>`。HTTP 前缀为 `{KNOWLEDGE_SERVICE_URL}/api/v1`。

### 0. 确认项目存在

- MCP：`olps_knowledge_project`（`siteId`）
- 若项目未初始化：`POST /api/v1/projects/:siteId/project`

### 1. 入库（imports）

MCP 首期无 import 工具，使用 HTTP：

1. `POST /api/v1/projects/:siteId/imports`，JSON 体任选其一：
   - `zipBase64`：整包 zip 的 Base64
   - `files`：`[{ "relativePath": "…", "contentBase64": "…" }, …]`
   - 可选 `sourceName`、`draftId`（审计）
2. 响应 `202`，记下 `importId`。
3. 轮询 `GET /api/v1/projects/:siteId/imports/:importId`，直到 `status` 为 `completed` 或 `failed`。

体积上限、扩展名分类与 Ingest 行为由服务端执行，见设计 [§3](design/knowledge-service.md#3-资料包导入)。代理侧不要自行解析包内文件内容后再写入 Wiki。

### 2. 检索（search）

- MCP：`olps_knowledge_search`，传入 `siteId`、`query`；需要按素材角色过滤时加 `role`。
- 等价 HTTP：`POST /api/v1/projects/:siteId/search`，JSON `{ "query": "…", "role": "…" }`。

### 3. 读 `assets-catalog` 与其他文件

- MCP：`olps_knowledge_read_file`，`path` 设为 `wiki/assets-catalog.md`。
- 列目录：`olps_knowledge_files`，`prefix` 可用 `wiki` 或 `raw/sources`。
- 素材列表：`olps_knowledge_assets`（可选 `role`）。
- 读任意允许路径的文本/元数据：同一 `read_file` 工具，或 `GET .../files/content?path=…`。

### 4. 处理 review

1. 列出待审：MCP `olps_knowledge_reviews`（可传 `status`，例如 `open`），或 `GET /api/v1/projects/:siteId/reviews`。
2. 按 `kind` 处理：
   - `asset_role_low_confidence`：需要改角色时先 `PATCH /api/v1/projects/:siteId/assets/:assetId`（JSON 含角色/说明等字段），再关闭待审。
   - `ingest_rejected_update`：按需用 `olps_knowledge_write_page` 或 Admin 修正 Wiki，再关闭待审。
3. 关闭待审（MCP 尚无 resolve 工具）：`POST /api/v1/projects/:siteId/reviews/:id/resolve`。

## 推荐操作顺序（单站）

1. 启动 knowledge HTTP → 配置并启动 MCP。
2. `olps_knowledge_status` 确认连通。
3. 确保 `siteId` 项目已初始化。
4. HTTP 提交 import → 等待 `completed`。
5. `olps_knowledge_search` / `olps_knowledge_read_file`（`wiki/assets-catalog.md`）核对内容。
6. `olps_knowledge_reviews` → 必要时 PATCH 资产 → `POST .../reviews/:id/resolve`。

## 相关代码与文档

- MCP 实现：`services/knowledge/src/mcp-server/`
- HTTP 应用：`services/knowledge/src/app.ts`
- 设计：[design/knowledge-service.md](design/knowledge-service.md)
- Wave 计划：[plans/2026-11-25-knowledge-service-wave-plan.md](plans/2026-11-25-knowledge-service-wave-plan.md)
- 验收清单：[validation/knowledge-service-acceptance.md](validation/knowledge-service-acceptance.md)
