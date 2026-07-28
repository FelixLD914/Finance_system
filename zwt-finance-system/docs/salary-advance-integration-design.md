# 工资预支单模块无损并入设计

> 状态：实施前设计基线（部分章节已被落地实现取代，见下方「落地差异」）
> 日期：2026-07-28
> 集成分支：`codex/salary-advance-integration`
> 当前系统基线：`138ca43`
> 来源仓库：`FelixLD914/Salary-Advance-Form`
> 来源基线：`8bfdf3b73532ce35db590913e32969f0af08ead3`
> 服务器约束：生产服务器不安装或调用 Microsoft Office / LibreOffice

## 0. 落地差异（2026-07-28 审计合入时确定，以代码为准）

本文写作时系统基线是 `138ca43`；实际合入发生在签名跨模块共用（`e8e6db4`）
落地之后，以下设计点已按现行系统收敛，本文相关章节仅作历史参考：

1. **不设 `salary_advance.signature_bindings` 绑定表。** 记录里的签名代码
   （`FIN_XING_LANHUI` 等）直接解析共享签名库 `core.signature_assets` 中
   **同名资产的最新 active 版本**——换签名、升版本、停用全部沿用签名库自身
   的语义与界面（系统管理 → 签名库），不再有第二套维护入口。凭证快照仍
   完整记录 asset id/name/version/sha256。
2. **不设 `salary_advance:template_manage` 权限点。** 签名维护统一走
   `signature:manage`（仅 admin，见 test_authz.py 策略锁定）。
3. **迁移编号为 `20260728_0010`**（原设计的 0007 已被 main 的汇率类型迁移
   占用）。
4. **签名人不允许推断兜底。** 原实现里「期间月份结尾 02 则默认龚尧文」的
   规则已删除：签名代码可从签字人姓名做确定性映射，无法确定时报
   `SIGNER_UNKNOWN` 校验错误。
5. **补充 `DELETE /batches/{id}`（仅未锁定批次）。** 同期间+工号跨批次查重
   意味着传错文件必须能删掉重来，否则该期间被永久毒化。
6. **功能开关在 router 依赖层统一拦截**，而不是只挡导入。
部署时需在签名库中把现有签名资产命名（或上传）为记录中使用的签名代码：
`FIN_XING_LANHUI`、`MD_GONG_YAOWEN`、`MD_ZHU_FAJIAN`。

## 1. 结论

工资预支单软件应当重构为 ZWT Finance 单体仓库中的原生
`salary_advance` 业务模块，而不是以子仓库、iframe、第二套 Web 应用、桌面 EXE
启动器或第二个数据库长期并存。

推荐方案同时满足：

- 用户只登录一次，只使用一个导航外壳和一套权限。
- 工资预支数据进入现有 `zwt_finance` 数据库的独立
  `salary_advance` schema。
- 原软件的 28 字段导入合同、逐行校验、模板版本、财务/总经理签名、单份预览、
  批量生成、失败重试、ZIP、合并 PDF、清单和哈希追溯均保留。
- WHT、TAX INV 现有表、接口、模板和文件不迁移、不重命名、不改变默认行为。
- 原软件中的真实员工数据和真实签名图片不进入 Git，也不复制到测试夹具。
- 新模块可以通过功能开关关闭；上线失败时不影响 WHT 和 TAX INV。

### 1.1 已确认的 PDF 方案

生产 PDF 沿用当前 WHT/TAX INV 的实现，不依赖服务器 Office：

```text
同一个不可变 GenerationSnapshot
    ├── 已批准 XLSX 模板 + openpyxl ───────────────→ XLSX
    └── 配套静态 PDF 底版 + 自动生成坐标
                              + ReportLab/pypdf ───→ PDF
```

XLSX 与 PDF 不在运行时互相转换，但必须读取同一个不可变数据快照，并绑定同一个模板
版本。静态 PDF 底版和坐标表只能在开发/制版机器上由已批准的 XLSX 模板自动生成，
不能在生产代码中手工维护第二套表单。每次启用模板时同时锁定 XLSX 哈希、PDF 底版
哈希和坐标版本，再通过字段一致性、页数和视觉黄金样例保证两种输出无损一致。

## 2. “无损并入”的验收定义

“无损”不是逐文件复制旧项目，而是以下五类能力没有静默退化。

### 2.1 业务能力无损

必须保留：

1. 上传 `.xlsx` 并选择期间。
2. 识别固定字段和受控表头别名。
3. 保存原始值、规范化值、原 Excel 行号和数据指纹。
4. 阻断错误、警告和重复记录检查。
5. 修改单条记录后重新校验。
6. 导出校验报告。
7. 不可变模板版本。
8. 财务负责人和总经理签名的不可变版本、角色、有效期和适用范围校验。
9. 申请人签名固定为 `Handwritten`，`表单模板!H26:J28` 永远留空。
10. 单份 PDF 预览。
11. 批量生成 XLSX/PDF。
12. 失败记录单独重试，不重复生成成功记录。
13. 下载单份文件、ZIP、合并 PDF 和 manifest。
14. 每份输出保存模板哈希、签名版本、数据指纹、XLSX/PDF SHA-256 和操作者。

### 2.2 文档结果无损

- Excel 模板仍是唯一业务版式源；PDF 底版和坐标表由它自动制版产生。
- 系统写入 `当前记录!B2:B27`，不按导入列序盲写。
- `当前记录` 必须保留并隐藏；`表单模板` 是唯一可见工作表。
- XLSX 与 PDF 必须读取同一个不可变 `GenerationSnapshot`。
- 每份输出必须记录配套的 XLSX 模板哈希、PDF 底版哈希和坐标版本。
- PDF 动态字段、勾选框和签名必须与 XLSX 的规范化字段逐项一致。
- PDF 必须可打开、非空、正好一页。
- 财务和总经理签名等比缩放且只能进入各自锚点。
- 申请人签名区域不能出现图片、占位符、内部版本号或调试文字。

### 2.3 数据无损

- 旧系统迁移时先做只读盘点和哈希清单。
- 原始导入文件、规范化快照、模板、生成文件和审计记录能够逐项对账。
- 迁移前后记录数、成功/失败状态、文件大小和 SHA-256 有核对报告。
- 旧 SQLite/旧 PostgreSQL 和旧输出目录在 UAT 完成前保持只读，不提前删除。

### 2.4 安全能力不倒退

- 所有业务接口沿用现有服务端会话、HttpOnly Cookie、CSRF 和角色权限。
- 原软件没有认证保护的接口不能原样挂到生产系统。
- 下载接口按登录用户和权限检查，不暴露磁盘绝对路径。
- 真实员工数据、工资文件、签名、生成文件和 `.env` 不进入 Git。
- 上传文件继续执行后端大小、扩展名、ZIP 结构、路径和图片内容检查。

### 2.5 运维能力不倒退

- 继续使用现有 5273/4273/8100 和 PostgreSQL 5435；不占用 BOI 端口或数据库。
- 继续走 `app.run_windows`、WinSW、Caddy 和现有备份/回滚流程。
- 不引入 Docker、WSL、第二套前端开发服务器或长期运行的第二个 HTTP API。
- 发布包和附件根目录分离，切换版本不丢历史文件。

## 3. 两个系统的差异

| 维度 | 工资预支单来源软件 | 当前 ZWT Finance | 并入策略 |
| --- | --- | --- | --- |
| 前端 | 独立 React/Vite/Ant Design，另有 CustomTkinter 桌面版 | React 19 + TS + Vite 8 + Ant Design 6 统一外壳 | 只迁移业务交互，不迁移 App 外壳 |
| 后端 | 独立同步 FastAPI，路由无现有会话依赖 | 异步 FastAPI + AsyncSession + 统一异常 | 改为异步 service/router |
| 数据库 | 独立模型；桌面版使用 SQLite | PostgreSQL 15，按 schema 隔离 | 新增 `salary_advance` schema |
| 建表 | 启动时 `Base.metadata.create_all` | Alembic 顺序迁移 | 只允许 Alembic |
| 权限 | 来源 Web API 未接入当前认证 | viewer/operator/approver/admin | 新增细粒度权限并锁定测试 |
| 文件 | 旧项目保存绝对路径 | 附件根目录 + storage key | 只保存相对 storage key |
| 签名 | 独立签名表，带代码/角色/范围 | `core.signature_assets` 已做不可变版本，但无工资模块授权元数据 | 新建模块绑定表引用 core 资产 |
| PDF | 最新桌面版使用 Excel COM | WHT/TAX INV 使用静态底版 + ReportLab/pypdf | 沿用现有无 Office 运行方案，底版和坐标由 XLSX 自动制版 |
| 任务 | 后台线程，进程中断恢复能力有限 | 当前无通用任务队列 | 使用数据库持久化任务 + 单并发执行器 |
| 发布 | 独立脚本/单文件 EXE | 单仓库 Windows release | 合并到现有 build/switch/test/backup |

## 4. 不采用的方案

### 4.1 直接把旧仓库复制进来

不采用。它会带来第二套认证、数据库会话、配置、端口、前端外壳和发布脚本；来源
仓库根目录还含真实签名图片，整包复制存在敏感资产进入新仓库的风险。

### 4.2 iframe 或反向代理旧应用

不采用。表面上出现在同一菜单，实际仍是两套会话、CSRF、权限、日志、附件和备份。
这不属于并入，只是把系统边界藏起来。

### 4.3 保留桌面 EXE，由 Web 系统调用

不采用。桌面版的 SQLite、输出目录和操作者身份无法自然进入服务端审计；服务器也
不能依赖交互式桌面会话。

### 4.4 服务器运行 Office COM 或 LibreOffice

不采用。生产服务器明确不能使用 Office，且当前 WHT/TAX INV 已有成熟的无 Office
生成链路。工资模块不引入 Excel COM、LibreOffice headless、`pywin32` 或交互式
桌面会话依赖。

### 4.5 直接 cherry-pick 来源仓库历史

不采用。来源项目的目录布局、同步 ORM、端口、启动方式和二进制/敏感资产边界与
当前仓库不同。应保留来源 commit 和文件哈希作为溯源信息，按模块边界重写并用黄金
样例证明行为等价。

## 5. 目标架构

```text
frontend/src/modules/salary-advance/
    SalaryAdvanceWorkspace.tsx
    api.ts
    types.ts
    components/

backend/app/modules/salary_advance/
    models.py
    schemas.py
    validation.py
    importer.py
    template_service.py
    signature_service.py
    document_generator.py
    document_service.py
    service.py
    router.py

PostgreSQL
    core.signature_assets
             ↑ 稳定服务层引用
    salary_advance.templates
    salary_advance.signature_bindings
    salary_advance.import_batches
    salary_advance.records
    salary_advance.generation_jobs
    salary_advance.generated_documents
    salary_advance.events

ZWT_ATTACHMENT_ROOT/
    salary-advance/source/
    salary-advance/templates/
    salary-advance/signatures/       # 实际图片仍由 core 资产管理
    salary-advance/generated/
    salary-advance/temp/
```

模块只能通过服务层读取 `core.signature_assets`。它不直接写 WHT、TAX INV 表，也不
允许 WHT/TAX INV 直接写工资预支表。

## 6. 数据模型

### 6.1 `salary_advance.templates`

- `id`
- `template_code`，固定 `SALARY_ADVANCE`
- `version`
- `file_name`
- `storage_key`
- `sha256`
- `pdf_underlay_storage_key`
- `pdf_underlay_sha256`
- `pdf_layout_version`
- `mapping_json`
- `signature_anchors_json`
- `visible_sheet`
- `active`
- `created_by_name`
- `created_at`

唯一约束：`(template_code, version)`。上传新文件必须创建新版本，不能原地覆盖。
一个版本只有在 XLSX、配套 PDF 底版和坐标表三者的哈希/版本校验都通过后才能启用。

### 6.2 `salary_advance.import_batches`

- `id`
- `batch_no`
- `period`
- `source_file_name`
- `source_storage_key`
- `source_sha256`
- `status`
- `total_rows`
- `valid_rows`
- `warning_rows`
- `invalid_rows`
- `created_by_name`
- `created_at`
- `locked_at`

### 6.3 `salary_advance.records`

- `id`
- `batch_id`
- `source_row_no`
- `period`
- `emp_id`
- `raw_data`
- `normalized_data`
- `data_fingerprint`
- `validation_status`
- `validation_errors`
- `validation_warnings`
- `generation_status`
- `revision`
- `superseded_at`
- `created_at`
- `updated_at`

同期间同工号默认只能存在一条未被 supersede 的当前记录。需要更正时走显式新版本
流程，旧记录不能覆盖或删除。

### 6.4 `salary_advance.signature_bindings`

该表不复制签名图片，只给 `core.signature_assets` 增加工资预支业务授权：

- `id`
- `signature_asset_id`
- `signature_code`
- `role`：`finance` / `managing_director`
- `valid_from`
- `valid_to`
- `scope_json`
- `active`
- `approved_by_name`
- `created_at`

这样不需要改变 WHT 现有签名默认值和状态，也不会让工资模块直接修改共享资产。

### 6.5 `salary_advance.generation_jobs`

- `id`
- `batch_id`
- `template_id`
- `status`
- `total_count`
- `success_count`
- `failed_count`
- `requested_by_name`
- `git_commit_sha`
- `started_at`
- `finished_at`
- `error_summary`

任务保存在数据库。API 进程重启后，未完成任务必须能被识别为可恢复或失败，不能永远
卡在“生成中”。

### 6.6 `salary_advance.generated_documents`

- `id`
- `job_id`
- `record_id`
- `generation_version`
- `xlsx_storage_key`
- `pdf_storage_key`
- `xlsx_sha256`
- `pdf_sha256`
- `template_id`
- `template_sha256`
- `pdf_underlay_sha256`
- `pdf_layout_version`
- `signature_versions`
- `data_fingerprint`
- `status`
- `error_code`
- `error_message`
- `created_at`

唯一约束至少覆盖 `(record_id, generation_version)`。重试成功时不覆盖旧失败证据；
重复请求遇到相同数据指纹、模板和签名版本时复用成功结果。

### 6.7 `salary_advance.events`

记录上传、校验、编辑、锁定、解锁、模板启停、签名绑定、生成、重试和下载。字段与
WHT `task_events` 保持相同风格，并额外保存 `object_type`、`object_id`、
`before_data`、`after_data` 和 `request_id`。

## 7. 权限设计

新增权限点：

- `salary_advance:read`
- `salary_advance:write`
- `salary_advance:generate`
- `salary_advance:template_manage`

角色映射：

| 角色 | read | write | generate | template_manage |
| --- | :-: | :-: | :-: | :-: |
| viewer | ✓ | | | |
| operator | ✓ | ✓ | | |
| approver | ✓ | ✓ | ✓ | |
| admin | ✓ | ✓ | ✓ | ✓ |

签名图片本体继续由现有 `signature:manage` 控制，仅 admin 可上传或停用。工资模块的
签名业务绑定也只允许 admin 管理。

来源数据里的 `approval_status` 是表单内容，不等于系统工作流批准。operator 可以
导入和修正记录，但只有 approver/admin 能锁定批次并生成带正式签名的文件。

## 8. API 映射

统一前缀：`/api/v1/salary-advance`。

| 来源能力 | 新接口 |
| --- | --- |
| 上传并校验 | `POST /batches/import` |
| 批次列表 | `GET /batches` |
| 批次详情 | `GET /batches/{id}` |
| 记录详情 | `GET /records/{id}` |
| 编辑记录 | `PATCH /records/{id}` |
| 重新校验 | `POST /batches/{id}/revalidate` |
| 校验报告 | `GET /batches/{id}/validation-report` |
| 锁定批次 | `POST /batches/{id}/lock` |
| 模板列表/上传/启停 | `/templates` |
| 签名业务绑定 | `/signature-bindings` |
| 单份预览 | `POST /records/{id}/preview` |
| 批量生成 | `POST /batches/{id}/generation-jobs` |
| 任务状态 | `GET /generation-jobs/{id}` |
| 失败重试 | `POST /generation-jobs/{id}/retry-failed` |
| ZIP | `GET /generation-jobs/{id}/zip` |
| 合并 PDF | `GET /generation-jobs/{id}/merged-pdf` |
| manifest | `GET /generation-jobs/{id}/manifest` |
| 单份文件 | `GET /documents/{id}/{format}` |

所有写接口经现有 CSRF 和权限依赖。文件下载只返回 `FileResponse`，不返回
`storage_key` 或绝对路径。

## 9. 导入与校验

移植来源 `validation.py` 的纯业务规则，但去掉同步数据库依赖。处理顺序：

1. 后端流式读取上传并限制 20 MiB。
2. 保存原始文件到附件根目录的临时位置并计算 SHA-256。
3. 验证 ZIP/XLSX 结构，不执行宏、不跟随外部链接。
4. 精确表头、受控别名、人工映射三层匹配。
5. 工号强制按字符串；金额全程 `Decimal`。
6. 期间、日期、审批枚举和申请人签名方式规范化。
7. 查询签名绑定的角色、状态、有效期和范围。
8. 检查批次内及当前有效记录中的 `期间 + 工号` 重复。
9. 一次事务写入批次和记录；失败时删除尚未引用的临时文件。

第 22 列 `申请人签名方式 / applicant_signature_mode` 保持固定，规范值只能是
`Handwritten`。

## 10. 模板与生成

### 10.1 模板种子

来源模板可以作为不含员工数据和真实签名的应用资产进入：

`backend/app/assets/templates/Salary-Advance-Template.xlsx`

配套制版资产同时进入：

```text
backend/app/assets/templates/Salary-Advance-Template.pdf
backend/app/modules/salary_advance/pdf_layout.py
```

其中 PDF 是不含动态员工数据和真实签名的静态底版，`pdf_layout.py` 是动态字段、
勾选框和签名锚点的坐标表。二者必须由
`scripts/build_salary_advance_underlay.py` 在装有 Excel 的受控制版机器上从已批准的
XLSX 自动生成，做法与现有 TAX INV 制版脚本一致。

发布初始化时把 XLSX 和 PDF 复制到附件根目录，登记为模板 `1.0.0`。之后的模板更新
只能通过管理接口创建新版本。构建脚本必须校验三个制版资产存在，并记录 XLSX SHA-256、
PDF SHA-256 和坐标版本。

### 10.2 XLSX 生成

来源生成器中的以下规则原样保留并拆成纯函数：

- 字段代码到 `B2:B27` 的固定映射。
- 日期写为 Excel 日期类型，金额写为数值。
- 申请人签名区清空。
- 财务和总经理签名锚点校验。
- 图片裁边、透明 PNG 和等比缩放。
- 审批勾选值固定。
- 计算属性和打印区域。
- `当前记录` 保留并隐藏，`表单模板` 唯一可见。
- 输出文件名净化并防止目录穿越。

纯生成函数只接受不可变输入快照并返回 bytes/临时文件，不访问数据库。服务层负责
事务、附件落盘、哈希和审计。

### 10.3 PDF 生成

生产运行时严格沿用现有 WHT/TAX INV 方案：

1. 从数据库加载已锁定记录、模板版本和签名版本，形成不可变
   `GenerationSnapshot`。
2. 使用 ReportLab 按 `pdf_layout.py` 绘制动态文本、日期、金额、勾选框和签名。
3. 使用 pypdf 把动态层合并到 `Salary-Advance-Template.pdf` 静态底版。
4. 校验输出为一页 A4、非空、可读取，并计算 SHA-256 后归档。

静态底版包含 Logo、固定标签、边框和不会随记录变化的说明；动态层只包含从
`GenerationSnapshot` 读取的字段及本次锁定的签名。申请人签名区域始终保持空白。

`scripts/build_salary_advance_underlay.py` 只在开发/制版机器上运行，职责是：

- 从已批准 XLSX 导出清洁的一页静态 PDF 底版。
- 测量命名区域或基准单元格，自动生成 `pdf_layout.py`。
- 把源 XLSX SHA-256 写入坐标文件，并输出底版 SHA-256。
- 拒绝底版中残留动态样例数据或真实签名。

生产发布包不包含该脚本的 Office 运行依赖。API 和 WinSW 服务不得导入或调用
`pywin32`、Excel COM 或 LibreOffice；服务器没有交互式 Office 会话也能生成全部
XLSX/PDF。

### 10.4 任务执行

当前规模不需要 Redis/Celery。采用数据库持久化任务加单并发后台执行器：

- API 事务创建 `queued` job 后立即返回。
- 应用内执行器用数据库锁领取任务。
- XLSX/PDF 渲染放到线程执行，不阻塞事件循环。
- 单记录提交结果，批次失败不回滚已成功文件。
- 进程启动时扫描超时的 `generating` 任务并恢复为可重试状态。
- 失败重试只领取失败记录。
- 每个临时目录带 job/record UUID，结束后清理。

如果后续吞吐量证明单执行器不足，再把同一模块入口独立为 worker 进程；它仍共用同一
仓库、数据库和附件目录，不新增 HTTP 微服务。

## 11. 前端并入

在 `src/modules/registry.tsx` 新增 `salary-advance`，并在 `App.tsx` 挂载
`SalaryAdvanceWorkspace`。

界面沿用现有高密度财务操作台：

- 生命周期页签：待处理、待生成、历史记录、数据维护。
- 主区为批次/记录台账，不复制来源项目的独立侧栏和顶部栏。
- 详情使用覆盖式抽屉，不为关闭状态预留右侧空列。
- 批量动作出现在原表格工具条位置。
- 模板和签名绑定放在数据维护视图。
- 所有文案进入 `i18n`，数据库只保存英文枚举。
- 泰文表单值使用现有 `ThaiText`/Sarabun 字体规则。
- 所有请求走 `shared/http.ts`，不使用来源项目的独立 axios base URL。

## 12. 旧数据迁移

迁移工具应是一次性 CLI，不是运行期双写：

```text
python -m app.cli salary-advance-audit-legacy --source <旧目录>
python -m app.cli salary-advance-import-legacy --manifest <审计清单>
python -m app.cli salary-advance-verify-migration --manifest <审计清单>
```

处理规则：

- SQLite 只读打开，不运行旧项目代码。
- 文件路径先解析到旧根目录下，拒绝越界路径。
- 员工原始导入表和生成文件复制到附件根目录并重新计算哈希。
- 旧模板按原版本登记，不覆盖当前模板。
- 旧签名按 SHA-256 与 core 资产对照；由管理员确认角色/有效期后建立绑定。
- 申请人签名图片一律拒绝迁入。
- 来源仓库根目录的真实签名 PNG 不进入新 Git 历史。
- 缺失文件、哈希不符或模型冲突记录为迁移异常，不静默跳过。

## 13. 测试与验收

### 13.1 后端

- 28 字段、表头别名、金额/日期/工号规范化。
- 同期间同工号重复阻断。
- 签名角色、状态、有效期和范围。
- 所有状态机非法跳转。
- viewer/operator/approver/admin 权限锁定。
- XLSX 内部工作表、映射、公式、打印区域和图片锚点。
- 路径穿越、公式注入、伪装图片、超大文件和损坏 ZIP。
- 幂等生成、部分失败、失败重试、进程恢复。
- 下载权限和审计。

### 13.2 文档黄金样例

只使用虚构员工和生成的测试签名：

- 单条成功。
- 多条批量成功。
- 一个错误行阻断。
- 一个转换失败后重试。
- Approve / Not approved / Pending。
- 中英泰长文本和金额边界值。

每个样例检查 XLSX SHA 之外的结构属性和 PDF 的页数、文本、尺寸、非空白，以及必要
的视觉差异。还要逐项比对 XLSX 与 PDF 中的动态字段、勾选状态和签名版本。不能把
真实工资表和真实签名作为 CI 夹具。

### 13.3 全量回归

提交前继续运行现有四条 CI 命令，工资模块测试只能增加，不能替代：

```powershell
Set-Location .\backend
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m pytest

Set-Location ..\frontend
npm.cmd run test
npm.cmd run build
```

涉及 PowerShell 发布脚本时还必须在实际 Windows 环境运行 happy path 和幂等路径。

## 14. 分阶段实施

### 阶段 A：安全骨架

- Alembic 新建 `salary_advance` schema 和表。
- 新增权限及策略测试。
- 注册后端路由和前端模块，但通过功能开关默认隐藏。
- 加入虚构数据黄金夹具。

退出条件：WHT/TAX INV 全量回归不变，新模块空壳受认证保护。

### 阶段 B：导入与校验

- 移植纯校验规则。
- 实现批次、记录、编辑、重新校验和校验报告。
- 完成重复、恶意文件和事务回滚测试。

退出条件：与来源项目的虚构样例逐行结果一致。

### 阶段 C：模板和签名

- 引入无敏感数据模板种子。
- 模板不可变版本。
- core 签名资产的工资业务绑定和授权校验。

退出条件：申请人区域强制空白；角色错误的签名不能生成。

### 阶段 D：生成与归档

- 完成静态 PDF 底版和坐标自动生成脚本。
- 实现 ReportLab 动态层和 pypdf 合并，生产端不调用 Office/LibreOffice。
- 实现单份预览、批量生成、持久任务、重试和哈希。
- 实现 ZIP、合并 PDF 和 manifest。

退出条件：在未安装 Office/LibreOffice 的目标服务器上通过 1/10/100 份稳定性、
XLSX/PDF 字段一致性和黄金 PDF 验收。

### 阶段 E：统一前端

- 完成台账、详情抽屉、导入、校验、生成进度、下载和数据维护。
- 完成中英文文案与前端测试。

退出条件：用户不需要进入旧 Web 或桌面 EXE 完成任何正常流程。

### 阶段 F：迁移与切换

- 旧系统只读审计。
- 预演迁移和对账。
- UAT。
- 生产备份、迁移、打开功能开关。
- 保留旧系统只读回退窗口。

退出条件：业务签字确认数据、文件、格式、权限和回滚演练。

## 15. 回滚策略

- 新表全部位于 `salary_advance` schema；迁移不改 WHT/TAX INV 业务表。
- core 签名资产不删除，仅增加模块引用。
- 前端导航和后端任务领取受同一功能开关控制。
- 回滚应用版本前先停止领取新任务，等待或标记运行中任务。
- 数据库和附件做同一时间点备份。
- 应用回滚后保留工资模块 schema 和附件，禁止为“干净”而自动 drop 数据。
- 只有确认不再需要数据时，另走人工备份和销毁审批。

## 16. 已锁定的服务器运行方案

生产服务器只允许以下生成链路：

- openpyxl 使用已批准的 XLSX 模板生成可编辑工作簿。
- ReportLab 使用自动生成的坐标表绘制 PDF 动态层。
- pypdf 把动态层合并到配套静态 PDF 底版。

生产依赖不得包含 `pywin32`、Excel COM 或 LibreOffice。正式启用模板前有五个硬门：

1. 坐标表声明的源 XLSX SHA-256 与已批准模板一致。
2. 数据库模板版本记录的 PDF SHA-256 与发布底版一致。
3. 坐标表由受控脚本生成，不能手工复制旧坐标后绕过哈希检查。
4. 虚构黄金样例通过 XLSX/PDF 字段、勾选、签名、一页 A4 和视觉回归。
5. 未安装 Office/LibreOffice 的目标服务器通过连续 1、10、100 份生成、服务重启和
   失败重试验证。

任一硬门失败时，该模板版本不能启用，但不影响现有 WHT/TAX INV 模块。
