# Open Landing Page System

落地页特化 CMS：**保留多租户**；本地鉴权登录后先选当前租户，之后都在该租户下操作，并可切换。

本仓库**独立**，不依赖 `landing-page-system` 的代码或包路径。

## 本地运行

```bash
docker compose up -d
copy .env.example .env
# 编辑 .env：填写 SSO_AUTHORITY（以及可选的 SSO_TEST_ACCOUNT / SSO_TEST_PASSWORD）
npm install
npm run build -w @olps/domain
npm run dev:api
```

另开终端：

```bash
npm run dev:admin
```

浏览器打开 `http://127.0.0.1:5173`，使用丝路赞 SSO **账号密码**或**手机验证码**登录，再选择租户。

协作 API 验收（本地注册账号 + 草稿 push，需 API 已启动且配置 REMOTE_SERVICE_URL / REMOTE_SERVICE_TOKEN）：

```bash
npm run mvp:check
# 可选：MVP_CHECK_ACCOUNT / MVP_CHECK_PASSWORD
```

## 先读

1. [docs/overview.md](docs/overview.md)  
2. [docs/tenant-context.md](docs/tenant-context.md)  
3. [docs/packages.md](docs/packages.md)  
4. [docs/flows/mvp-happy-path.md](docs/flows/mvp-happy-path.md)  
