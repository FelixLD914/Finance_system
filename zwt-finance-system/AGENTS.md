# ZWT Finance System — 工程约定

正式生产系统，处理真实税票与 WHT 凭证。动手前先读完这一页。

本文件是**索引和护栏**，不复制细节；每条都指向唯一事实源，改动请改事实源。

## 提交前必须全绿

CI（`.github/workflows/ci.yml`）跑的就是这四条，本地先跑一遍：

```powershell
Set-Location .\backend; .\.venv\Scripts\python.exe -m ruff check .
Set-Location .\backend; .\.venv\Scripts\python.exe -m pytest
Set-Location .\frontend; npm.cmd run test
Set-Location .\frontend; npm.cmd run build
```

后端必须用 `python -m pytest` 而不是 `pytest`：CI 不安装 `app` 包，靠 `-m` 把
当前目录放进 `sys.path`。

## 改了 PowerShell 脚本，必须实际运行一遍

`scripts/` 和 `deploy/windows/` 下的脚本没有自动化测试覆盖。历史上连续四个缺陷
都是用户先撞上、而不是审查发现的，且全部落在 happy path（"一切就绪"时崩溃、
BOM、空行、幂等替换）。**语法检查和肉眼审查不算验证**，要真的跑，包括
"什么都不需要做"的那条分支。

## 不可越过的边界

- **不碰 BOI。** 同机并存。禁止占用 BOI 的 5173 / 4173 / 8000，禁止连 5434 上
  BOI 的 PostgreSQL 实例。ZWT 用 5273 / 4273 / 8100 和 5435。见 [README.md](README.md)
  的 Port allocation 与 Database instance。
- **`Stop-Zwt.ps1` 靠命令行里的 `zwt-finance-system` 字样识别自家进程**
  （[scripts/_ZwtCommon.ps1](scripts/_ZwtCommon.ps1)）。**重命名这个目录会让进程
  归属判断失效，可能误杀 BOI 的服务。**
- 不修改 IIS 站点、80/443 绑定或现有证书；不使用 Docker / WSL2 / 容器。
- 密钥、BOT API 凭证、数据库口令、私钥不得进 Git。`.env` 已被忽略，只提交
  `.env.example`。
- Windows 上后端必须经 `app.run_windows` 启动（SelectorEventLoop，psycopg 异步
  要求）。直接 `uvicorn` 会用 Proactor 事件循环并失败。
- 发布验收探活用 `/api/health/ready`（真跑一次 `SELECT 1`），不要用 `/live`。

## 已锁定的业务规则 —— 改动前须重新走业务确认

这些不是实现细节，是业务方确认过的口径。

| 规则 | 事实源 |
| --- | --- |
| 角色与职责分离四条决定（approver 可自录自批、作废与批准同级、WHT/TAX INV 共用批准人、`signature:manage` 仅 admin） | [README.md](README.md) + `backend/tests/test_authz.py` 的策略锁定测试 |
| WHT 编号不变量（`ZWTYYYYMMNNN` / 补开 `ZWTYYYYMMBKRSS`，正式号只在批准事务中分配） | [docs/architecture.md](docs/architecture.md) |
| TAX INV 规则（开票日期取报关提交日期、`ZWT-IVYYYYMMDD-NN`、18 行上限禁止批准不得截断、作废号不回收、汇率最多回溯 9 天） | [docs/architecture.md](docs/architecture.md) |
| 模块只能通过服务层读共享数据，WHT 与 TAX INV 不直接写对方业务表 | [docs/architecture.md](docs/architecture.md)，对应 `core` / `wht` / `tax_invoice` / `audit` 四个 PG schema |
| 视觉与文案基准（高密度财务台账、业务页无衬线、全宽表格、覆盖式详情抽屉、默认简体中文、UI 文案不得作为业务数据持久化） | 仓库根 `PRODUCT.md` 与 `DESIGN.md`；`../zwt-finance-ui-prototype/` 仅作历史原型参考 |

### 已确认的前端设计方向

- 业务页面使用 DM Sans + Noto Sans SC Variable，泰文使用 Sarabun。衬线字体仅允许
  用于左上角品牌标识，不得用于业务标题、标签、按钮和数据。
- 页面标题 24–26px，控件默认 32px，台账行 36–40px；金额右对齐，金额、编号、
  税号、日期和汇率使用等宽数字。
- WHT 与 TAX INV 的台账统一为待处理、待出具、历史记录、全部记录四个生命周期
  页签；主数据维护（收款方、识别导入、汇率）为模块内平行视图。
- 台账默认占满可用宽度；详情使用覆盖式抽屉，不得在详情关闭、无选中记录或空数据
  时预留右侧空列。
- 色彩只表达主操作、选择、业务状态和风险。静态工作表面默认无宽阴影，不使用卡片
  拼贴、装饰渐变、玻璃拟态或营销式文案。
- WHT 的批量开具与历史迁移必须作为两个有说明的操作入口；批量勾选后在原表格工具条
  位置显示批量动作，不另起 dashboard 卡片。
- 签名图库统一在系统管理维护并显示 WHT / TAX INV 适用范围；生成文件只在适用范围
  内选取签名，绝不跨范围选用（范围内无签名则出不带签名的文件，不挡出票）。
  BOT 多币种、接口自检和报价明细统一放在 TAX INV 的「BOT 汇率中心」视图。

### TAX INV 数字格式

`ROUND_HALF_UP`，三种精度不可混用
（[backend/app/modules/tax_invoice/document_generator.py](backend/app/modules/tax_invoice/document_generator.py)）：

- 金额 **2 位小数**
- 单价 **4 位小数**
- 数量 **0 位小数**（业务口径：无小数）

数量列若出现小数会被静默进位，且导入链路目前没有对应校验 —— 改动格式化逻辑
时优先补校验，不要只改显示。

## 改动会波及多处的地方

- **改后端端口要同步三处**：根 `.env`、`deploy/windows/winsw/zwt-finance-api.xml`
  的 `ZWT_API_PORT`、`deploy/windows/Caddyfile` 的 `reverse_proxy`；
  `Test-ZwtServer.ps1` 用 `-ApiPort` 传同一个值。目前没有单一事实源。
- **改 TAX INV Excel 模板，必须一起重新生成 PDF 底版和坐标表**，否则 PDF 会错位。
  在装有 Excel 的开发机上跑 `scripts/build_tax_inv_underlay.py`；坐标表在
  `backend/app/modules/tax_invoice/pdf_layout.py`。生产机不装 Excel。
- **改 `backend/requirements.lock` 会改变发布包内容** ——
  `deploy/windows/Build-ZwtRelease.ps1` 会校验它存在并取 SHA-256。测试工具不要
  加进这份 lock。
- **`POST /v1/tax-invoice/import/migration` 是一次性通道，历史迁移跑完后必须整个
  删掉**。它是全系统唯一能由调用方指定税票编号的入口：直接写出 `approved` 记录
  并推进编号计数器，绕过人工复核。摘除清单见
  [docs/windows-deployment.md](docs/windows-deployment.md)「上线后必须摘掉的一次性
  通道」。**摘的时候不要收窄 `import_batches.import_mode` 的 CHECK 约束**——迁移
  留下的审计行正是 `'migration'`，收窄会让它们违反约束。

## 目录职责

```
backend/     FastAPI。core/ 是平台能力，modules/ 按业务模块划分（= PG schema）
             app/assets/ 随发布包走，发布前会被 Build-ZwtRelease 硬性校验
frontend/    React 19 + TS。i18n/ shared/ 是平台能力，不在模块内复制
             src/modules/registry.tsx 是模块注册表，新模块从这里挂进外壳
scripts/     开发机用（Initialize / Start / Stop）+ 两个需要 Excel 的制版脚本
deploy/      生产机用（Build / Switch / Test / Backup）。配置一律 .example
docs/        architecture.md 是业务不变量，windows-deployment.md 是发布流程
```

## 待补

- 发布验收要求的 WHT / TAX INV **黄金样例目前没有仓库位置**
  （[docs/windows-deployment.md](docs/windows-deployment.md) 第 7 步），验收依赖
  个人手上的文件，无法从仓库复现。脱敏口径待业务确认。
- 前端测试目前只覆盖 `registry.tsx`。
