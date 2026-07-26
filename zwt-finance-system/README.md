# ZWT Finance System

正式工程采用前后端分离的单仓库结构，生产环境为纯 Windows 原生服务。

## Technology baseline

- Frontend: React 19 + TypeScript + Vite 8 + Ant Design 6
- Backend: FastAPI + SQLAlchemy 2 + Alembic
- Database: PostgreSQL 15（独立数据库，不读取或写入 BOI 数据库）
- Service: WinSW
- Reverse proxy: Caddy，内网非标准 HTTPS 端口

## Local development

1. 复制 `.env.example` 为 `.env`，按本机 PostgreSQL 15 修改连接信息。
2. 前端：

   ```powershell
   Set-Location .\frontend
   npm.cmd install --cache .npm-cache
   npm.cmd run dev
   ```

3. 后端：

   ```powershell
   Set-Location .\backend
   py -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
   .\.venv\Scripts\python.exe -m app.run_windows
   ```

前端开发服务器为 `http://127.0.0.1:5273`，`/api` 仅在开发期间代理到
`http://127.0.0.1:8100`。生产环境由 Caddy 同源转发。

## Authentication

所有业务接口都要求登录。只有 `/api/health/*`（供 WinSW 与发布验收探活）和
`/api/v1/auth/login` 不需要会话。

- 会话为**服务端会话**，令牌放在 `HttpOnly` + `Secure` + `SameSite=Strict`
  Cookie 里，JS 读不到，XSS 偷不走。数据库 `core.sessions` 只存令牌的
  SHA-256 摘要，备份泄露也换不出可用凭证。
- 删除会话行即刻吊销，`set-password` / `deactivate` 会自动吊销该用户全部会话。
  这是相对 JWT 选服务端会话的主要原因。
- 写请求还需 `X-CSRF-Token` 头，值取自非 HttpOnly 的 `zwt_csrf` Cookie
  （双提交校验）。前端 `src/shared/http.ts` 已统一处理，业务代码无需关心。
- 口令用标准库 `hashlib.scrypt`（N=2^16, r=8, p=2），无第三方依赖。参数写进
  哈希串本身，日后调高强度不需要迁移数据，登录时会顺带升级旧参数的记录。

首次部署必须先建管理员账号。**口令不接受命令行参数**（会进 shell 历史，
Windows 上还能被其他进程从进程列表读到），默认交互式输入：

```powershell
Set-Location .\backend
.\.venv\Scripts\python.exe -m app.cli create-user --username admin --role admin --display-name 系统管理员
```

无人值守脚本用环境变量传：

```powershell
$env:ZWT_ADMIN_PW = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText
.\.venv\Scripts\python.exe -m app.cli create-user --username admin --role admin --password-env ZWT_ADMIN_PW
```

其他命令：`list-users`、`set-password`、`deactivate`、`purge-sessions`。

### 角色与职责分离

角色到权限点的映射在 `app/core/authz.py`（2026-07-26 经业务方确认）：

| 权限点 | viewer | operator | approver | admin |
| --- | :-: | :-: | :-: | :-: |
| `invoice:read` / `wht:read` | ✓ | ✓ | ✓ | ✓ |
| `invoice:write` / `wht:write` | | ✓ | ✓ | ✓ |
| `invoice:approve` / `wht:approve` | | | ✓ | ✓ |
| `invoice:void` / `invoice:correct` | | | ✓ | ✓ |
| `invoice:generate` / `wht:generate` | | | ✓ | ✓ |
| `signature:manage` / `user:manage` | | | | ✓ |

三项已确认的决定，**改动前需重新走业务确认**：

1. `approver` 包含录入权限，可以自己录、自己批。职责分离靠的是 `operator`
   拿不到批准权，而不是反过来限制 `approver`。
2. 作废与批准同级 —— 作废一张已签发税票不需要更高授权。
3. WHT 与 TAX INV 共用同一批批准人，`_APPROVE` 不拆分。

新建用户默认是 `operator`（`User.role` 的默认值），因此默认情况下录入人
无法批准自己录的单。

这三条在 `tests/test_authz.py` 里有对应的策略锁定测试：断言的是"能批准的
角色集合 == 能作废的角色集合"这类关系而非具体角色名，任何一侧被单独收紧
或放宽都会让测试失败，避免策略被静默改掉。

尚未确认：`signature:manage` 目前只给 `admin`。签名图片决定正式 PDF 上盖
谁的名字，若要独立授权需新增角色。

## Port allocation

本机与 BOI 系统并行开发，**ZWT 不得占用 BOI 的端口**。分配规则为
"BOI + 100"：

| 用途 | BOI（禁止占用） | ZWT |
| --- | --- | --- |
| 前端开发服务器 | 5173 | **5273** |
| 前端 preview | 4173 | **4273** |
| 后端 API | 8000 | **8100** |

前端两个端口都设了 `strictPort: true`：端口被占用时 Vite 直接失败退出，
不会静默改用 5274 之类的端口而让 `/api` 代理失效。

临时改口用环境变量覆盖，不要改默认值：

- 前端：`ZWT_DEV_PORT` / `ZWT_PREVIEW_PORT` / `ZWT_API_TARGET`，
  写在 `frontend/.env.local`（见 `frontend/.env.example`）。
- 后端：`ZWT_API_PORT`，写在根目录 `.env`。

改后端端口时必须同步三处：根目录 `.env`、
`deploy/windows/winsw/zwt-finance-api.xml` 的 `ZWT_API_PORT`、
`deploy/windows/Caddyfile` 的 `reverse_proxy`。
`Test-ZwtServer.ps1` 用 `-ApiPort` 传入同一个值。

Windows 必须通过 `app.run_windows` 启动。该入口会在 Uvicorn 创建事件循环前
显式创建 SelectorEventLoop，以满足 SQLAlchemy + psycopg 异步连接要求；WinSW
配置也使用同一入口。`/api/health/live` 仅检查进程存活，
`/api/health/ready` 会执行 PostgreSQL `SELECT 1`，发布验收必须使用后者。

WHT Excel 按管理员批准的 `.xlsx` 模板生成。WHT PDF 使用随应用发布的四联 PDF
底版、ReportLab 和 pypdf 叠加业务值与签名，不调用 Microsoft Office/Excel COM，
因此低权限 WinSW 服务账号不需要桌面登录会话或安装 Office。签名原图、生成文件均
保存到 `ZWT_ATTACHMENT_ROOT`，由每日附件备份一并保护。

TAX INV 已接入旧系统 `Sample.xlsx` 历史导入、Export Invoice Excel + 报关单 PDF
双文件识别、BOT Excel/API 汇率台账、周末/无报价日最多 9 天回溯、FOB 计算复核、
批准时事务编号及正式 Excel 生成。日期字段严格分离：开票日期取报关提交日期，
`ZWT-IVYYYYMMDD-NN` 的日期段取开票日期，汇率目标日期与实际命中日期分别保存。
旧台账缺少独立报关提交日期时会标记为低置信度，必须人工确认后才能批准。
正式税票作废后原编号永久保留；更正单复制原业务数据重新进入复核，并分配新的
不可重复编号。

## Project boundaries

- 旧 WHT/TAX INV 程序只作为功能和验收参考。
- 正式数据只进入本系统 PostgreSQL 数据库。
- WHT/TAX INV 之间只能通过共享核心服务读取公共数据，不直接修改彼此表。
- 密钥、BOT API 凭证、数据库密码和私钥不得提交到 Git。

详见 [架构说明](docs/architecture.md) 和
[Windows 发布说明](docs/windows-deployment.md)。
