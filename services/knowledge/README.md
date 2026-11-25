# @olps/knowledge

站点 Wiki 文件权威存储与导入处理的独立 HTTP 服务（首期仅脚手架与存活检查）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `KNOWLEDGE_SERVICE_TOKEN` | 服务间鉴权令牌（必填）；管理 API 以 `KNOWLEDGE_SERVICE_URL` + 同一令牌调用本服务 |
| `KNOWLEDGE_SERVICE_URL` | 管理 API 侧配置，指向本服务根地址（不含路径后缀） |
| `KNOWLEDGE_ROOT` | 项目根目录，默认 `.intermediate/knowledge-data` |
| `KNOWLEDGE_IMPORT_MAX_BYTES` | 单次导入合计上限，默认 `104857600`（100MB） |
| `MEDIA_MAX_BYTES` | 单文件上限，默认 `20971520`（20MB），与 API 媒体上传一致 |
| `KNOWLEDGE_HOST` | 监听地址，默认 `127.0.0.1` |
| `KNOWLEDGE_PORT` | 监听端口，默认 `19828` |
| `DATABASE_URL` | PostgreSQL 连接串；导入完成后写入 `knowledge_documents` / `knowledge_assets` / `knowledge_imports` 投影，并供 `POST .../projection/rebuild` 重建 |

## 鉴权

所有 HTTP 路由（含 `GET /health`）须在请求头携带：

```http
Authorization: Bearer <KNOWLEDGE_SERVICE_TOKEN>
```

## 启动

```bash
# 开发
export KNOWLEDGE_SERVICE_TOKEN=dev-token
npm run dev -w @olps/knowledge

# 生产构建后
npm run build -w @olps/knowledge
npm run start -w @olps/knowledge
```

业务 API 前缀为 `/api/v1`。除 `GET /health` 外，首期已提供站点 project 初始化、文件列表/读取，以及资料包导入：

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/projects/:siteId/imports` | 创建导入（JSON：`zipBase64` 或 `files[]` + `relativePath`/`contentBase64`）；超限与坏包返回 400，接受后 202 并异步写入 `raw/sources` |
| GET | `/projects/:siteId/imports/:importId` | 读取 `.olps-knowledge/imports/<importId>/status.json` 中的状态与统计 |
| POST | `/projects/:siteId/projection/rebuild` | 可选 JSON `importId`；从 Wiki/抽取元数据重建投影行 |

同站导入任务串行入队；次要任务在首次未完成时可观测 `queued` 状态。单次合计与单文件上限见上表环境变量。