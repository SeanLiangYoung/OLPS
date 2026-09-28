# 包与服务职责

| 目录 | 职责 |
| --- | --- |
| `apps/admin` | 账号登录、工作区、页面与 Guide 编辑、所有者管理、发布与同步、业务模块 |
| `services/api` | 用户与会话、资源权限、数据库操作、草稿业务和同步协调 |
| `services/remote` | 接收 Git bundle、保存网站版本、验证公开文件并提供 HTTP 访问 |
| `packages/domain` | 用户、网站、草稿、页面与 Guide 类型及领域校验 |
| `packages/sync` | Git 工作目录、版本保存、Pull/Push、Agent 冲突处理及同步状态 |
| `packages/site-builder` | 根据源码构建网站、验证发布文件、安装独立 Node 构建程序 |

这些目录通过本仓库的 npm workspaces 组织。依赖使用正式包名与版本，测试和运行配置均使用仓库相对路径。

管理界面与命令行通过相同的管理 API 操作用户资源。远端代码接口使用独立服务凭据，公开网站接口直接服务浏览器。
