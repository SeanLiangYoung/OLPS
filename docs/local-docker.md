# 本地 Docker 运行

## 启动服务

安装并启动 Docker Desktop，在仓库根目录执行：

```bash
docker compose up -d --build --wait
docker compose ps
```

四个服务均应显示 healthy：`postgres`、`remote`、`api`、`admin`。

- 管理后台：`http://127.0.0.1:5173`。
- API 健康检查：`http://127.0.0.1:8787/api/health`。
- 远端网站：`http://127.0.0.1:8790/s/:remoteSiteId/`，具体地址由 Push 返回。
- PostgreSQL：`127.0.0.1:5434`，数据库、用户名和密码均为 `olps`。

以上端口仅发布到本机地址。管理后台使用 Nginx 提供构建后的静态文件，并将 `/api`、`/preview-access` 等请求转发至管理 API。API 在容器网络中通过 `postgres:5432` 访问数据库，通过 `remote:8790` 访问远端服务。公开网站中的询盘请求使用本机 API 地址。

Compose 直接提供运行配置；可在根目录 `.env` 设置 `REMOTE_SERVICE_TOKEN`，API 和远端服务会使用相同的值。现有数据库由 API 启动时自动检查并迁移；迁移 legacy 数据前需要按照 [migration-rehearsal.md](migration-rehearsal.md) 准备所有权映射及备份。

## 操作与数据

```bash
docker compose logs --tail 100 api remote admin
docker compose stop
docker compose start --wait
```

`olps_pg` volume 保存数据库；`olps_api` volume 保存草稿 Git 仓库和预览文件；`olps_remote` volume 保存远端 Git 仓库及发布内容。停止或重建容器会保留这些 volume。

修改源码后执行 `docker compose up -d --build --wait` 更新运行版本。

## 模型、知识与外部服务配置

根目录 `.env.example` 列出完整配置。用户可以保留外部凭据为空，后台仍可执行页面编辑、预览、协作和发布；生成任务会记录缺少模型凭据的错误，邮件任务等待 SMTP 配置，Google 页面显示未配置状态。

业务模型默认使用 `MiniMax-M3`，服务端读取 `MINIMAX_API_KEY`、`MINIMAX_BASE_URL` 和 `MINIMAX_MODEL`。国内接口默认 `https://api.minimax.cn/v1`，国际接口可配置 `https://api.minimax.io/v1`。浏览器不会接收模型凭据。

本地 llm-wiki 通过 Markdown 文件目录导入知识库。Docker 运行时配置 `LLM_WIKI_HOST_PATH` 为本机知识目录，Compose 将其只读挂载至 `/app/wiki`；`LLM_WIKI_ALLOWED_ACCOUNTS` 填写允许导入的登录账号，以逗号分隔。源码运行时使用 `LLM_WIKI_ROOT` 指定目录。后台生成页面选择知识库后可以导入文档。导入会更新同路径文档、删除目录中已经移除的导入文档，手工添加的知识文档继续保留。未指定用户知识目录时，系统尚未连接用户的本地 llm-wiki。

SMTP 配置包含 `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM` 和 `SMTP_TO`。后台询盘页面显示发送任务、尝试次数及错误。发送过程意外中断产生的结果不明任务，需要核实收件情况后手工重发。

Google 配置包含 OAuth 客户端、回调地址、令牌加密密钥和 Ads developer token。`GOOGLE_TOKEN_ENCRYPTION_KEY` 使用 32 字节随机值的 Base64 编码，可在本机执行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` 生成。默认回调地址为 `http://127.0.0.1:5173/api/google/callback`，需要加入 Google 客户端允许的回调地址。后台完成授权后绑定可访问的 Ads customer ID 和 GA property ID，随后查询实际账户数据。

修改 `.env` 后执行 `docker compose up -d api` 应用配置。完整验收步骤见 [CMS 验收说明](cms-acceptance.md)。

## 验收

```bash
docker compose exec api npm run mvp:check
```

该命令创建验收账号和草稿、创建页面、Push 发布，并查询已发布页面。每次运行会保留对应的验收数据。公开网站访问、浏览器预览和询盘提交使用下方浏览器测试进一步检查。

## 源码开发与测试

本机使用满足依赖要求的 Node.js；本次环境使用 Node.js 24.21.0。执行：

```bash
npm ci
npm run build
npm run typecheck
docker compose exec postgres createdb -U olps olps_test_api
docker compose exec postgres createdb -U olps olps_test_e2e
```

测试数据库创建命令用于首次准备；已有数据库可以直接使用。测试通过独立 schema 管理数据，数据库名称必须包含 `_test_`。

浏览器文件和测试输出保存在仓库已忽略的目录：

```bash
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.intermediate/browsers"
npx playwright install chromium
npm run test
npm run test:e2e -w @olps/admin
```

API 测试默认连接 `postgres://olps:olps@127.0.0.1:5434/olps_test_api`；专用浏览器测试使用 `olps_test_e2e`。浏览器测试默认访问本机 5173、8787 和 8790 端口，部分测试另外启动专用服务。

Cursor Agent 在 macOS/Linux 直接调用可执行文件；Windows 默认通过 `LOCALAPPDATA` 定位 PowerShell 脚本。`CURSOR_AGENT_COMMAND` 可指定程序路径。需要先执行 `cursor-agent login`，或在运行环境设置 `CURSOR_API_KEY`。安装及登录方式见 [Cursor 安装文档](https://prod.cursor.com/docs/cli/installation)和[认证文档](https://prod.cursor.com/docs/cli/reference/authentication)。

Docker 镜像包含固定版本 `2026.10.22-27dcf5f` 的 Linux Agent。容器处理合并冲突需要在根目录 `.env` 配置 `CURSOR_API_KEY`，更新后执行 `docker compose up -d api`。运行 `docker compose exec api cursor-agent status` 检查认证状态。该凭据只传递至 API 容器。

GitHub Actions 在 push 和 pull request 时执行构建、类型检查、基础包测试、CMS 核心数据库检查、Docker 启动和浏览器测试。手动运行工作流时执行包含真实 Agent 的完整单元与数据库集成测试，需要仓库配置 `CURSOR_API_KEY` secret。完整测试与核心检查分别显示运行结果。

## 备份与恢复

数据库、API 数据目录及远端数据目录需要共同保存。执行备份时停止应用写入，PostgreSQL 保持运行。

```bash
backup_dir="$PWD/.intermediate/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
docker compose stop api remote admin
docker compose exec -T postgres pg_dump -U olps -Fc olps > "$backup_dir/database.dump"
docker compose run --rm --no-deps -T -v "$backup_dir:/backup" --entrypoint tar api -czf /backup/api.tar.gz -C /app/.intermediate .
docker compose run --rm --no-deps -T -v "$backup_dir:/backup" --entrypoint tar remote -czf /backup/remote.tar.gz -C /app/.intermediate/remote-data .
docker compose start --wait api remote admin
```

备份文件需要另外复制到持久保存的位置。恢复时使用 `pg_restore --exit-on-error` 导入数据库，并将两个 tar.gz 文件解压至 API 与远端对应的数据 volume。数据库恢复目标及 volume 应为空。启动时保留原来的服务路径配置，使数据库记录、Git 仓库和发布目录使用一致的位置。

部署配置文件需要单独保存。恢复 Google 连接时继续使用原来的 `GOOGLE_TOKEN_ENCRYPTION_KEY`，用于读取数据库中的已加密令牌；模型、SMTP 和 Google 客户端配置也需要恢复到运行环境。

恢复验收包括账号登录、草稿页面查询、Git 历史读取，以及公开 HTML 与备份前内容的比较。2026-10-25 已使用独立数据库、独立 volume 和独立服务完成这些检查，原有服务在备份后恢复运行。

直接开发源码时，可以只启动 PostgreSQL：停止应用容器后执行 `docker compose up -d postgres`，将 `.env.example` 复制为 `.env`，运行 `npm ci` 和 `npm run build`，分别启动以下进程。

```bash
REMOTE_SERVICE_TOKEN=olps-remote-dev-token REMOTE_PUBLIC_BASE_URL=http://127.0.0.1:8790 REMOTE_DATA_ROOT="$PWD/.intermediate/remote-data" npm run dev:remote
npm run dev:api
npm run dev:admin
```

管理 API 读取仓库根目录 `.env`。远端服务通过进程环境变量获取配置。`HOST` 控制 API 监听地址，默认 `127.0.0.1`；Compose 设置为 `0.0.0.0`，用于容器之间访问。

系统工具与 Cursor Agent 在独立的 `runtime-base` 阶段安装，修改业务源码会复用这些依赖。Debian 软件包使用 HTTPS 下载；首次安装使用 Node 附带的根证书验证连接，安装 `ca-certificates` 后使用系统证书配置。软件包下载失败会终止构建。

固定版本的 Agent 安装文件通过 aria2 下载，支持并行连接、断点续传和连接超时检查。单独执行 `docker/install-cursor-agent.sh` 的 Linux 环境需要先安装 aria2，Docker 与持续检查已经声明该依赖。
