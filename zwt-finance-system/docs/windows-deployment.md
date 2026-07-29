# Windows Server 2016 原生发布

## 不可变边界

- 不使用 Docker Desktop、WSL2、Linux VM 或 Windows 容器。
- 不修改 IIS 站点、80/443 绑定或现有证书。
- Caddy 只监听管理员分配的内网 DNS 名称和非标准 HTTPS 端口。
- 生产机不自动 `git pull`、不自动上线。

## 服务器管理员准备项

管理员决定安装盘、数据盘、独立备份物理盘、内部 DNS、HTTPS 端口和低权限服务
账号。先运行 `Test-ZwtServer.ps1`；脚本只读取系统、磁盘、端口和工具版本，不安装
或修改组件。Vite 8 构建所用 Node 必须为 `22.12.0` 或更高，且可通过脚本参数指向
NVM 的独立版本，不修改全局默认 Node。

推荐目录（盘符由管理员替换）：

```text
<install>\ZWTFinance\
  releases\<release-id>\
  current -> releases\<release-id>    # junction
  services\
  logs\
<data>\ZWTFinance\data\attachments\
<backup>\ZWTFinance\backups\
```

## 人工发布顺序

1. 从 GitHub `main` 获取指定提交，在新的 `releases\<id>` 目录展开。
2. 运行 `Build-ZwtRelease.ps1`。脚本在新目录执行前端 `npm ci`、测试和构建，
   后端创建独立 `.venv` 并安装 `requirements.lock`；它不会切换线上版本。
3. 执行前端测试、后端测试、Alembic 检查和 Caddy `validate`。
4. 备份数据库与附件，并验证备份文件 SHA-256。
5. 进入维护页后执行数据库迁移。
6. 运行 `Switch-ZwtRelease.ps1` 停止 API、切换 `current` junction 并重新启动 API，
   再 reload Caddy。
7. 运行 `Test-ZwtRelease.ps1`、WHT/TAX INV 黄金样例；失败则切回前一 junction，
   并按迁移说明回退。
8. 在维护窗口内完成首份新版本备份及恢复校验。

维护窗口从切换维护页开始计时，最长 2 小时。完整恢复演练目标不超过 4 小时。

API 验收使用数据库就绪端点，不以进程存活代替：

```powershell
$ready = Invoke-RestMethod -Uri "https://<internal-dns>:<port>/api/health/ready"
if ($ready.status -ne "ready" -or $ready.database -ne "ok") {
    throw "ZWT Finance API/PostgreSQL readiness check failed."
}
```

WHT 与 TAX INV 的 PDF 运行时都不依赖 Microsoft Office、Excel COM 或交互式
Windows 登录会话。发布包必须包含
`backend\app\assets\templates\WHT-Template.pdf`、
`backend\app\assets\templates\TAX-INV-Template.pdf` 和
`backend\app\assets\fonts\Sarabun-Regular.ttf`。管理员另行维护经业务批准的
`ZWT_WHT_TEMPLATE_PATH` Excel 模板；模板变更应作为受控配置变更并先用黄金样例验收。

管理员还须把经业务批准的 TAX INV Excel 模板配置到
`ZWT_TAX_INVOICE_TEMPLATE_PATH`。发布验收至少验证一份包含周末汇率回溯的税票，
确认 Q14 为报关提交日对应的开票日期、O/P 商品列仍显示汇率目标日与实际匹配汇率，
且正式编号日期段与 Q14 一致。当前模板最多 18 条商品，超过时系统必须拒绝批准，
不得截断。

TAX INV 的 PDF 底版是由该 Excel 模板一次性制版得到的静态三联 PDF，坐标表在
`backend\app\modules\tax_invoice\pdf_layout.py`。**Excel 模板一旦变更，底版和坐标表
必须一起重新生成**，否则 PDF 会错位：在装有 Excel 的开发机上跑
`scripts\build_tax_inv_underlay.py`（生产机不需要、也不应安装 Excel）。
坐标表头部记录了生成时所用模板的 sha256，可用于核对是否已过期。

## 上线后必须摘掉的一次性通道：TAX INV 历史迁移

`POST /api/v1/tax-invoice/import/migration` 是**全系统唯一能由调用方指定税票
编号的入口**。它凭一份 Excel 直接写出状态为 `approved` 的税票、沿用文件里的
`DocumentNo`、并把编号计数器推到该编号之后——绕过人工复核这一整层。

它只为一件事存在：把旧系统已经正式开出的票搬进来。**这件事一辈子只做一次。**
做完之后它就是纯风险敞口，没有任何业务收益。

现有三层防护（都到位，但都拦不住有权限的人误用）：

- 权限：`invoice:migrate`，仅 admin（见 `backend/app/core/authz.py` 第 5 条决定）
- 完整性：带编号的行必须过与人工批准完全相同的校验（`check_approval_readiness`）
- 常规批量开具（`/import/sample`）已经**一律拒绝**文件里的编号

### 迁移完成后的摘除清单

按此顺序删，删完跑 `python -m ruff check .` 与 `python -m pytest`：

1. `backend/app/modules/tax_invoice/router.py` —— 整个 `import_historical_migration`
   端点。
2. `backend/app/modules/tax_invoice/service.py` —— `import_migration()` 方法；
   `_create_import` / `_assert_importable` 的 `allow_existing_numbers` 参数
   （去掉参数后 `number_not_allowed` 分支变成无条件生效，这正是想要的终态）。
3. `backend/app/core/authz.py` —— `Permission` 里的 `invoice:migrate` 与第 5 条决定注释。
4. 测试：`test_authz.py` 的 `test_confirmed_migration_is_admin_only` 与
   `test_migrate_is_strictly_narrower_than_approve`；`test_auth_enforcement.py` 的
   `MUTATING_ENDPOINTS` 对应行与 `test_migration_import_needs_more_than_plain_write`；
   `test_tax_invoice_ledger_export.py` 里以 `allow_existing_numbers=True` 为前提的用例。
5. 前端：`modules/tax-invoice/api.ts` 的 `importMigration`；`TaxInvoiceWorkspace.tsx`
   的 `batchMode` 切换与 `canMigrate`；i18n 的 `tax.batchMode*` / `tax.batchMigration*`。
   **`tax.issueNumberNotAllowed` 要留着**——摘掉迁移后它反而成了常态提示。

### 不要做的一件事

**不要写迁移把 `import_batches.import_mode` 的 CHECK 约束收窄回 `('dual','sample')`。**

刚跑完的那批迁移在 `import_batches` 里留下的正是 `import_mode = 'migration'` 的
审计行。收窄约束会让这些历史行违反约束、迁移直接失败；强行清掉它们则等于抹掉
「这批票是迁移进来的」这一事实。**枚举值留着，只把写入路径拿掉。**

## HTTPS 与内部 CA

`Caddyfile.example` 使用 `tls internal`。服务账号无权自动写入用户信任库时，由管理员
导出 Caddy 内部 CA 根证书，经企业流程分发到 Edge 客户端信任库。Caddy 版本必须在
真机预检后锁定；请求体限制指令要求 Caddy 2.10 或更高。

## 备份

计划任务每天调用 `Backup-ZwtFinance.ps1`，同时备份 PostgreSQL 自定义格式 dump 和
附件（含签名原图与已生成正式文件），保留 7 天。备份盘必须与数据盘属于不同物理磁盘。该方案不能抵御整机丢失、
机房灾害或数据盘与备份盘同时损坏；业务方已接受，异地容灾另行立项。

正式切换后的首份备份必须由 `Test-ZwtBackupRestore.ps1` 恢复到临时校验库，确认
schema/table 可读后再删除临时库。恢复校验完成时间属于 2 小时维护窗口。
