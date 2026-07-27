<#
.SYNOPSIS
    为 ZWT 建立一个**独立的** PostgreSQL 15 集群（cluster），与 BOI 的实例完全隔离。

.DESCRIPTION
    本机现状：
      postgresql-x64-18  端口 5432  运行中  只有系统库，无用户数据
      postgresql-x64-15  端口 5434  已停止  BOI 的实例（~250 个 boi_* 库）

    项目边界要求"独立数据库，不读取或写入 BOI 数据库"。在 BOI 的集群里新建一个
    库只能做到逻辑隔离 —— 连接数、共享内存、WAL、备份与 PITR 恢复窗口仍然是同
    一份，BOI 做一次全库恢复就会波及 ZWT。本脚本改为新建一个独立集群：

      postgresql-zwt15   端口 5435  数据目录 E:\PGDATA\zwt15   仅 ZWT 使用

    共用 E:\PG15\bin 的同版本程序文件，但数据目录、Windows 服务、端口、超级用户
    口令、WAL 与备份全部独立。停掉 BOI 的服务不影响 ZWT，反之亦然。

    需要管理员权限（注册 Windows 服务）。口令一律交互式输入，不接受命令行参数。

.PARAMETER DataDirectory
    新集群的数据目录。默认 E:\PGDATA\zwt15（E: 盘剩余空间最多且 PG15 程序也在 E:）。

.PARAMETER Port
    新集群监听端口。默认 5435（5432 归 PG18，5434 归 BOI 的 PG15）。

.PARAMETER ServiceName
    Windows 服务名。默认 postgresql-zwt15。

.PARAMETER BinDirectory
    PostgreSQL 15 程序目录。默认 E:\PG15\bin。

.PARAMETER RepairExisting
    集群已由 initdb 建好、但服务注册或启动失败时使用。跳过 initdb（因此不会
    重设超级用户口令），只重写配置、修正服务账号与目录权限并重新启动。

.EXAMPLE
    # 在"以管理员身份运行"的 PowerShell 里执行
    .\Initialize-ZwtPostgres.ps1

.EXAMPLE
    # 上次跑到一半失败，集群已存在时
    .\Initialize-ZwtPostgres.ps1 -RepairExisting
#>
[CmdletBinding()]
param(
    [string]$DataDirectory = "E:\PGDATA\zwt15",
    [ValidateRange(1024, 65535)]
    [int]$Port = 5435,
    [string]$ServiceName = "postgresql-zwt15",
    [string]$BinDirectory = "E:\PG15\bin",
    [switch]$RepairExisting
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_ZwtCommon.ps1")

Write-Host ""
Write-Host "ZWT 独立 PostgreSQL 15 集群" -ForegroundColor Cyan
Write-Host ""

# --- 预检 --------------------------------------------------------------------

Write-Step "预检"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Err "需要管理员权限才能注册 Windows 服务。"
    Write-Err "请在'以管理员身份运行'的 PowerShell 里重新执行本脚本。"
    exit 1
}
Write-Ok "管理员权限"

$initdb = Join-Path $BinDirectory "initdb.exe"
$pgCtl  = Join-Path $BinDirectory "pg_ctl.exe"
$psql   = Join-Path $BinDirectory "psql.exe"
foreach ($exe in @($initdb, $pgCtl, $psql)) {
    if (-not (Test-Path $exe)) {
        Write-Err "找不到 $exe。请用 -BinDirectory 指定 PostgreSQL 15 的 bin 目录。"
        exit 1
    }
}
Write-Ok "PostgreSQL 15 程序目录: $BinDirectory"

$clusterExists = Test-Path (Join-Path $DataDirectory "PG_VERSION")
$serviceExists = $null -ne (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)

if ($RepairExisting) {
    if (-not $clusterExists) {
        Write-Err "-RepairExisting 需要 $DataDirectory 下已有集群（找不到 PG_VERSION）。"
        Write-Err "该目录尚无集群，请去掉 -RepairExisting 正常执行。"
        exit 1
    }
    Write-Ok "集群已存在，进入修复模式（不会重跑 initdb，超级用户口令保持不变）"
    if ($serviceExists) {
        Write-Host "    注销既有服务 $ServiceName ..."
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        & $pgCtl unregister -N $ServiceName
        if ($LASTEXITCODE -ne 0) { Write-Err "注销服务失败"; exit 1 }
        Start-Sleep -Seconds 2
        Write-Ok "已注销"
    }
} else {
    if ($serviceExists) {
        Write-Err "服务 $ServiceName 已存在。"
        Write-Err "若上次执行到一半失败，请改用： -RepairExisting"
        exit 1
    }
    if ($clusterExists) {
        Write-Err "数据目录已有集群: $DataDirectory"
        Write-Err "若上次执行到一半失败，请改用： -RepairExisting"
        exit 1
    }
    if ((Test-Path $DataDirectory) -and @(Get-ChildItem $DataDirectory -Force -ErrorAction SilentlyContinue).Count -gt 0) {
        Write-Err "数据目录已存在且非空: $DataDirectory"
        Write-Err "initdb 拒绝写入非空目录。请换一个目录或先清空。"
        exit 1
    }
}

$portOwner = Get-PortOwner -Port $Port
if ($null -ne $portOwner) {
    Write-Err "端口 $Port 已被占用 (PID $($portOwner.ProcessId), $($portOwner.Name))"
    exit 1
}
Write-Ok "端口 $Port 空闲"

# 与既有实例的端口对照，确认不会撞上。
foreach ($svc in (Get-CimInstance Win32_Service -Filter "Name LIKE '%postgres%'" -ErrorAction SilentlyContinue)) {
    Write-Host "    既有实例: $($svc.Name) [$($svc.State)]"
}

Write-Host ""
Write-Host "    $(if ($RepairExisting) { '将要修复：' } else { '将要创建：' })" -ForegroundColor Yellow
Write-Host "      数据目录 : $DataDirectory"
Write-Host "      端口     : $Port"
Write-Host "      服务名   : $ServiceName"
Write-Host ""
$confirm = Read-Host "    确认继续？(y/N)"
if ($confirm -ne "y") {
    Write-Host "    已取消。"
    exit 0
}

# --- initdb ------------------------------------------------------------------

if ($RepairExisting) {
    Write-Step "跳过 initdb（集群已存在）"
} else {

Write-Step "创建集群"

$parent = Split-Path -Parent $DataDirectory
if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

Write-Host "    接下来 initdb 会提示设置超级用户 (postgres) 口令。" -ForegroundColor Yellow
Write-Host "    这是新集群自己的口令，与 BOI 实例无关。" -ForegroundColor Yellow
Write-Host ""

# --encoding=UTF8   泰文与中文数据的硬性要求。
# --locale=C        确定性的字节序排序。Windows 上的 libc locale 名称各机器不一致，
#                   用 C 避免"换台机器排序结果就变"的问题。代价是 ORDER BY 对
#                   泰文/中文按字节序而非语言习惯排序；确有需要时在查询里用
#                   COLLATE 指定，不要靠集群默认值。
# --data-checksums  BOI 的集群没开（数据页校验和版本 0）。正式税票与 WHT 凭证
#                   值得用一点写入开销换取静默磁盘损坏的早期发现。
# --auth-local / --auth-host 必须显式指定为 scram-sha-256。
# initdb 的默认值是 trust —— 本机任何进程都能免密以任意角色连库，
# 对存放正式税票的系统不可接受。initdb 只会打一行警告就继续，很容易漏掉。
& $initdb --pgdata="$DataDirectory" --encoding=UTF8 --locale=C --data-checksums `
    --auth-local=scram-sha-256 --auth-host=scram-sha-256 `
    --username=postgres --pwprompt
if ($LASTEXITCODE -ne 0) {
    Write-Err "initdb 失败"
    exit 1
}
Write-Ok "集群已创建（UTF8 / C locale / 已启用数据页校验和）"

}   # end if (-not $RepairExisting)

# --- 配置 --------------------------------------------------------------------

Write-Step "写入配置"

$confFile = Join-Path $DataDirectory "postgresql.conf"
# Get-Content 会自动识别并剥掉 BOM，读进来的是纯文本；写回时用
# Write-TextFileNoBom 保证不再写出 BOM。
$conf = @(Get-Content $confFile)

# 先删掉本脚本此前追加过的块，再重新追加 —— 否则 -RepairExisting 每跑一次
# 就多一份重复配置。同时匹配旧版的中文标记，便于从早期版本升级。
$markers = @(
    "# --- ZWT dedicated instance (managed by Initialize-ZwtPostgres.ps1) ---",
    "# --- ZWT 独立实例 ---"
)
$cut = -1
for ($i = 0; $i -lt $conf.Count; $i++) {
    if ($markers -contains $conf[$i].Trim()) { $cut = $i; break }
}
if ($cut -ge 0) {
    Write-Host "    移除此前追加的配置块（第 $($cut + 1) 行起）"
    # 连同标记前的空行一起去掉，避免反复运行后堆积空行。
    while ($cut -gt 0 -and $conf[$cut - 1].Trim() -eq "") { $cut-- }
    $conf = @($conf[0..([Math]::Max($cut - 1, 0))])
    if ($cut -eq 0) { $conf = @() }
}

# 追加到文件末尾即可 —— postgresql.conf 后出现的赋值覆盖先前的同名项，
# 不需要改动 initdb 生成的原始内容。
# 全部用 ASCII：这个文件由 PostgreSQL 在确定任何编码之前解析，
# 不要在里面放非 ASCII 字符（中文说明留在本脚本里）。
$conf += ""
$conf += $markers[0]
$conf += "port = $Port"
$conf += "listen_addresses = 'localhost'"
$conf += "log_destination = 'stderr'"
$conf += "logging_collector = on"
$conf += "log_directory = 'log'"
$conf += "log_min_duration_statement = 2000"
$conf += "log_connections = on"
$conf += "log_disconnections = on"

# 必须无 BOM。PS 5.1 的 Set-Content -Encoding UTF8 会写 BOM，
# PostgreSQL 会报 "第 1 行, 行尾附近语法错误" 并拒绝启动。
Write-TextFileNoBom -Path $confFile -Lines $conf
Write-Ok "端口 $Port，仅监听 localhost，已开启连接日志"

# pg_hba.conf 里任何 trust 规则都要清掉。修复模式下这一步尤其重要：
# 早期版本的本脚本没给 initdb 传 --auth-*，建出来的集群是 trust，
# 本机任何进程都能免密以任意角色连库。
$hbaFile = Join-Path $DataDirectory "pg_hba.conf"
$hba = @(Get-Content $hbaFile)
$trustCount = @($hba | Where-Object {
    $_.Trim() -ne "" -and -not $_.Trim().StartsWith("#") -and $_ -match '\btrust\s*$'
}).Count
if ($trustCount -gt 0) {
    Write-Warn "pg_hba.conf 中有 $trustCount 条 trust 规则（免密登录），正在改为 scram-sha-256"
    Copy-Item $hbaFile "$hbaFile.bak-trust" -Force
    $hba = $hba | ForEach-Object {
        if ($_.Trim() -ne "" -and -not $_.Trim().StartsWith("#") -and $_ -match '\btrust\s*$') {
            $_ -replace '\btrust\s*$', 'scram-sha-256'
        } else { $_ }
    }
    Write-TextFileNoBom -Path $hbaFile -Lines $hba
    Write-Ok "已改为 scram-sha-256（原文件备份为 pg_hba.conf.bak-trust）"
} else {
    Write-Ok "pg_hba.conf 无 trust 规则"
}

# --- 注册服务 ----------------------------------------------------------------

Write-Step "注册 Windows 服务"

# 服务账号用 NetworkService，与本机既有的 postgresql-x64-15 / -18 一致。
# pg_ctl register 不带 -U 时默认 LocalSystem，而 postgres.exe 拒绝以具有
# 管理员权限的账号运行，服务会起不来。NetworkService 是低权限内置账号，
# 不需要口令。
$serviceAccount = "NT AUTHORITY\NetworkService"

# 数据目录由当前管理员账号创建，NetworkService 默认没有权限，必须显式授予。
Write-Host "    授予 $serviceAccount 对数据目录的权限..."
& icacls.exe "$DataDirectory" /grant "${serviceAccount}:(OI)(CI)F" /T /Q
if ($LASTEXITCODE -ne 0) {
    Write-Err "授予数据目录权限失败"
    exit 1
}
Write-Ok "数据目录权限已授予"

& $pgCtl register -N $ServiceName -D "$DataDirectory" -S auto -U "$serviceAccount"
if ($LASTEXITCODE -ne 0) {
    Write-Err "注册服务失败"
    exit 1
}
$startedAt = Get-Date
try {
    Start-Service -Name $ServiceName -ErrorAction Stop
} catch {
    Write-Err "服务启动失败: $($_.Exception.Message)"
    Show-PostgresStartFailure -DataDirectory $DataDirectory -Since $startedAt
    exit 1
}

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    if ($null -ne (Get-PortOwner -Port $Port)) { break }
    Start-Sleep -Milliseconds 500
}
if ($null -eq (Get-PortOwner -Port $Port)) {
    Write-Err "服务已注册但未在 30 秒内监听 $Port。"
    Show-PostgresStartFailure -DataDirectory $DataDirectory -Since $startedAt
    exit 1
}
Write-Ok "$ServiceName 已启动并监听 $Port"

# --- 建库与角色 --------------------------------------------------------------

Write-Step "创建 zwt_finance 数据库与应用角色"
Write-Host ""
Write-Host "    接下来为应用角色 zwt_finance_app 设置口令。" -ForegroundColor Yellow
Write-Host "    这个口令稍后要填进 .env 的 ZWT_DATABASE_URL。" -ForegroundColor Yellow
$securePassword = Read-Host "    zwt_finance_app 口令" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $appPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

# 口令通过 stdin 传给 psql，不出现在命令行参数里（命令行可被其他进程读取）。
# 单引号转义成两个单引号，避免口令里的引号破坏 SQL。
$escaped = $appPassword.Replace("'", "''")
$sql = @"
CREATE ROLE zwt_finance_app WITH LOGIN PASSWORD '$escaped';
CREATE DATABASE zwt_finance OWNER zwt_finance_app ENCODING 'UTF8';
-- 应用角色不需要建库/建角色权限，最小权限原则。
ALTER ROLE zwt_finance_app NOSUPERUSER NOCREATEDB NOCREATEROLE;
"@

$env:PGPASSWORD = $null   # 超级用户口令由 psql 交互式索取
Write-Host "    psql 会提示输入刚才设置的 postgres 超级用户口令。" -ForegroundColor Yellow
$sql | & $psql --host=localhost --port=$Port --username=postgres --dbname=postgres --no-psqlrc --set=ON_ERROR_STOP=1 --file=-
$sqlExit = $LASTEXITCODE
$appPassword = $null
$sql = $null

if ($sqlExit -ne 0) {
    Write-Err "建库失败。集群已就绪，可手动执行："
    Write-Err "  $psql -h localhost -p $Port -U postgres"
    exit 1
}
Write-Ok "zwt_finance 数据库与 zwt_finance_app 角色已创建"

Write-Host ""
Write-Host "完成。ZWT 拥有独立的 PostgreSQL 15 集群：" -ForegroundColor Green
Write-Host "  服务     $ServiceName"
Write-Host "  端口     $Port"
Write-Host "  数据目录 $DataDirectory"
Write-Host "  与 BOI 的 postgresql-x64-15 (5434) 完全独立：数据文件、服务、"
Write-Host "  超级用户、WAL、备份互不影响。"
Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "  .\scripts\Initialize-ZwtDev.ps1"
Write-Host "  数据库端口填 $Port，用户 zwt_finance_app，库名 zwt_finance"
Write-Host ""
