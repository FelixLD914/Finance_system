# ZWT Finance System

正式工程采用前后端分离的单仓库结构，生产环境为纯 Windows 原生服务。

## Technology baseline

- Frontend: React 19 + TypeScript + Vite 8 + Ant Design 6
- Backend: FastAPI + SQLAlchemy 2 + Alembic
- Database: PostgreSQL 15（独立数据库，不读取或写入 BOI 数据库）
- Service: WinSW
- Reverse proxy: Caddy，内网非标准 HTTPS 端口

## Database instance

ZWT 使用**独立的 PostgreSQL 15 集群**，不与 BOI 共用实例。开发机上的实例分布：

| 服务 | 端口 | 用途 |
| --- | --- | --- |
| `postgresql-x64-18` | 5432 | 只有系统库，非本项目使用 |
| `postgresql-x64-15` | 5434 | **BOI 的实例**（约 250 个 `boi_*` 库），不要连 |
| `postgresql-zwt15` | 5435 | **ZWT 专用**，由 `Initialize-ZwtPostgres.ps1` 建立 |

三者端口不冲突，可以同时运行。

项目边界要求"独立数据库，不读取或写入 BOI 数据库"。在 BOI 的集群里新建一个库
只能做到逻辑隔离 —— 连接数、共享内存、WAL、备份与 PITR 恢复窗口仍是同一份，
BOI 做一次全库恢复就会波及 ZWT。因此改为独立集群：数据目录、Windows 服务、
端口、超级用户口令、WAL 与备份全部独立，只共用同版本的程序文件。

首次建立，在**以管理员身份运行**的 PowerShell 里执行。管理员窗口默认落在
`C:\Windows\system32`，所以用完整路径（下面按本机路径示例，请按实际仓库位置替换）：

```powershell
D:\AI\gpt_codex\finan_system_DIV_Part\zwt-finance-system\scripts\Initialize-ZwtPostgres.ps1
```

只有这一个脚本需要管理员权限（注册 Windows 服务）。其余脚本用普通权限运行。

集群参数及其理由：

- `--encoding=UTF8` —— 泰文与中文数据的硬性要求。
- `--locale=C` —— 确定性的字节序排序。Windows 上 libc locale 名称各机器不一致，
  用 C 避免"换台机器排序结果就变"。代价是 `ORDER BY` 对泰文/中文按字节序而非
  语言习惯排序；确有需要时在查询里用 `COLLATE`，不要依赖集群默认值。
- `--data-checksums` —— BOI 的集群未启用。正式税票与 WHT 凭证值得用一点写入
  开销换取静默磁盘损坏的早期发现。
- `listen_addresses = 'localhost'` —— 应用与 Caddy 都在同一台机器，没有理由把
  数据库暴露到网段。
- `log_connections = on` —— 记录连接来源，审计需要。

`Start-Zwt.ps1` 启动时会按 `.env` 里实际配置的端口核对监听情况，指到 BOI 的
5434 上会告警。

## Local development

以下脚本都用**普通权限**运行（不要用管理员窗口 —— `npm install` 以管理员身份
写 `node_modules` 会留下普通用户改不动的文件）。先切到仓库根目录：

```powershell
Set-Location D:\AI\gpt_codex\finan_system_DIV_Part\zwt-finance-system
```

首次部署，一条命令完成依赖安装、`.env` 生成、数据库迁移和管理员账号创建：

```powershell
.\scripts\Initialize-ZwtDev.ps1
```

数据库端口填 **5435**（`Initialize-ZwtPostgres.ps1` 建的 ZWT 专用实例），
不是默认提示的 5432。

之后每次启动：

```powershell
.\scripts\Start-Zwt.ps1
```

停止：

```powershell
.\scripts\Stop-Zwt.ps1
```

前端开发服务器为 `http://127.0.0.1:5273`，`/api` 仅在开发期间代理到
`http://127.0.0.1:8100`。生产环境由 Caddy 同源转发。

### 脚本说明

| 脚本 | 作用 |
| --- | --- |
| `Initialize-ZwtPostgres.ps1` | 建立 ZWT 专用的 PostgreSQL 15 集群（需管理员权限，只需跑一次） |
| `Initialize-ZwtDev.ps1` | 首次部署。可重复执行，已完成的步骤自动跳过 |
| `Start-Zwt.ps1` | 启动后端与前端（各开一个窗口，日志可见），等健康检查通过后开浏览器 |
| `Stop-Zwt.ps1` | 按端口停止本项目进程 |

常用参数：

```powershell
.\scripts\Start-Zwt.ps1 -BackendOnly      # 只起后端
.\scripts\Start-Zwt.ps1 -Recreate         # 端口被本项目旧进程占用时先停再起
.\scripts\Start-Zwt.ps1 -NoBrowser        # 不自动开浏览器
.\scripts\Initialize-ZwtDev.ps1 -SkipInstall   # 只做 .env 与迁移
```

两条安全约束写进了脚本，不是靠人记：

- **启动前后都检查本项目没有占用 BOI 的 5173 / 4173 / 8000。** 一旦某处配置
  退回旧默认值，`Start-Zwt.ps1` 会打出占用端口的 PID 和完整命令行并中止，
  而不是让两套系统互相踩。
- **`Stop-Zwt.ps1` 只停命令行里含 `zwt-finance-system` 的进程。** 目标端口上
  如果是别的程序，只报告不动手，需要 `-Force` 才会停 —— 避免误杀 BOI 的服务。

后端等待的是 `/api/health/ready` 而不是 `/live`：前者会真的执行一次
PostgreSQL `SELECT 1`，能把"进程起来了但连不上库"当场暴露出来。

手工启动（不用脚本）：

```powershell
Set-Location .\backend; .\.venv\Scripts\python.exe -m app.run_windows
Set-Location .\frontend; npm.cmd run dev
```

Windows 上后端必须走 `app.run_windows`，直接 `uvicorn` 会用 Proactor 事件循环，
psycopg 的异步实现不支持。

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

四项已确认的决定，**改动前需重新走业务确认**：

1. `approver` 包含录入权限，可以自己录、自己批。职责分离靠的是 `operator`
   拿不到批准权，而不是反过来限制 `approver`。
2. 作废与批准同级 —— 作废一张已签发税票不需要更高授权。
3. WHT 与 TAX INV 共用同一批批准人，`_APPROVE` 不拆分。
4. `signature:manage` 只给 `admin`。能批准一张税票，不等于能改上面盖谁的章。

新建用户默认是 `operator`（`User.role` 的默认值），因此默认情况下录入人
无法批准自己录的单。

这四条在 `tests/test_authz.py` 里有对应的策略锁定测试：断言的是"能批准的
角色集合 == 能作废的角色集合"这类关系而非具体角色名，任何一侧被单独收紧
或放宽都会让测试失败，避免策略被静默改掉。

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
