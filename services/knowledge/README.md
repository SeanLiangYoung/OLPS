# @olps/knowledge

站点 Wiki 文件权威存储与导入处理的独立 HTTP 服务（首期仅脚手架与存活检查）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `KNOWLEDGE_SERVICE_TOKEN` | 服务间鉴权令牌（必填） |
| `KNOWLEDGE_ROOT` | 项目根目录，默认 `.intermediate/knowledge-data` |
| `KNOWLEDGE_IMPORT_MAX_BYTES` | 单次导入合计上限，默认 `104857600`（100MB） |
| `MEDIA_MAX_BYTES` | 单文件上限，默认 `20971520`（20MB），与 API 媒体上传一致 |
| `KNOWLEDGE_HOST` | 监听地址，默认 `127.0.0.1` |
| `KNOWLEDGE_PORT` | 监听端口，默认 `19828` |

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

后续业务 API 前缀为 `/api/v1`；当前仅提供 `GET /health`。