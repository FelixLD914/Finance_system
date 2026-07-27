# 开发脚本共用的常量与辅助函数。由 Start-Zwt / Stop-Zwt / Initialize-ZwtDev 点源引入。
# 面向 Windows PowerShell 5.1：不使用 && / ?? / 三元运算符。

Set-StrictMode -Version Latest

# 端口一律 "BOI + 100"。BOI 的端口在本机属于另一套系统，占用即事故。
$script:ZwtDevPort      = 5273
$script:ZwtPreviewPort  = 4273
$script:ZwtApiPort      = 8100
$script:BoiReservedPorts = @(5173, 4173, 8000)

$script:ZwtRoot     = Split-Path -Parent $PSScriptRoot
$script:BackendRoot = Join-Path $script:ZwtRoot "backend"
$script:FrontendRoot = Join-Path $script:ZwtRoot "frontend"
$script:VenvPython  = Join-Path $script:BackendRoot ".venv\Scripts\python.exe"
$script:EnvFile     = Join-Path $script:ZwtRoot ".env"
$script:EnvExample  = Join-Path $script:ZwtRoot ".env.example"

function Write-TextFileNoBom {
    <#
        .SYNOPSIS
        写文本文件，UTF-8 且**不带 BOM**。

        .DESCRIPTION
        Windows PowerShell 5.1 里 `Set-Content -Encoding UTF8` 写的是
        **带 BOM** 的 UTF-8（开头 EF BB BF），这会直接破坏两类文件：

          postgresql.conf  PostgreSQL 的配置解析器把 BOM 当作第 1 行的内容，
                           报 "第 1 行, 行尾附近语法错误" 并拒绝启动。
          .env             python-dotenv 按 utf-8 读取但不剥 BOM，
                           第一个键会变成 "﻿ZWT_ENVIRONMENT" 而静默失效。

        两者都不能带 BOM，所以统一走这个函数，不要再用 Set-Content -Encoding UTF8。
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        # AllowEmptyString 是必需的：Mandatory 的 [string[]] 参数会拒绝数组里
        # 的空字符串，而配置文件和 .env 都含空行。AllowEmptyCollection 兜住
        # 整个数组为空的情况。
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [AllowEmptyCollection()]
        [string[]]$Lines
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($Path, $Lines, $utf8NoBom)
}

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "    $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "    $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host "    $Message" -ForegroundColor Red
}

function Get-PortOwner {
    <#
        .SYNOPSIS
        返回占用指定端口的进程；端口空闲则返回 $null。
    #>
    param([Parameter(Mandatory = $true)][int]$Port)

    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $conn) { return $null }

    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    $commandLine = ""
    try {
        $wmi = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction Stop
        $commandLine = $wmi.CommandLine
    } catch {
        $commandLine = ""
    }

    return [pscustomobject]@{
        Port        = $Port
        ProcessId   = $conn.OwningProcess
        Name        = if ($proc) { $proc.ProcessName } else { "(未知)" }
        CommandLine = $commandLine
    }
}

function Assert-BoiPortsUntouched {
    <#
        .SYNOPSIS
        确认本项目不会占用 BOI 的端口。

        .DESCRIPTION
        BOI 系统在本机使用 5173 / 4173 / 8000。这些端口上如果出现的是本项目的
        进程，说明某处配置退回了旧默认值 —— 直接拦下，不要让两套系统互相踩。
        端口被 BOI 自己占用是正常的，不干预。
    #>
    $violations = @()
    foreach ($port in $script:BoiReservedPorts) {
        $owner = Get-PortOwner -Port $port
        if ($null -eq $owner) { continue }
        if ($owner.CommandLine -like "*zwt-finance-system*") {
            $violations += "端口 $port 被本项目进程占用 (PID $($owner.ProcessId)): $($owner.CommandLine)"
        }
    }
    if ($violations.Count -gt 0) {
        Write-Err "检测到本项目占用了 BOI 的保留端口："
        foreach ($v in $violations) { Write-Err "  $v" }
        Write-Err "请检查 frontend/vite.config.ts 与 .env 的 ZWT_API_PORT 是否被改回旧值。"
        throw "BOI 保留端口被占用，已中止"
    }
}

function Test-Prerequisites {
    <#
        .SYNOPSIS
        检查开发环境是否已初始化。返回缺失项列表，全部就绪时返回空数组。
    #>
    $missing = @()
    if (-not (Test-Path $script:EnvFile))    { $missing += ".env 不存在（从 .env.example 复制并填入数据库口令）" }
    if (-not (Test-Path $script:VenvPython)) { $missing += "后端虚拟环境不存在: $script:VenvPython" }
    if (-not (Test-Path (Join-Path $script:FrontendRoot "node_modules"))) { $missing += "前端依赖未安装: frontend/node_modules" }
    return $missing
}

function Wait-ForHttp {
    <#
        .SYNOPSIS
        轮询一个 URL 直到返回 2xx 或超时。返回 $true/$false。
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { return $true }
        } catch {
            # 服务还没起来，继续等。
        }
        Start-Sleep -Milliseconds 700
    }
    return $false
}

function Wait-ForPort {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($null -ne (Get-PortOwner -Port $Port)) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Get-EnvValue {
    <#
        .SYNOPSIS
        从 .env 读取单个键的值。读不到返回 $null。

        .DESCRIPTION
        只做最简解析（KEY=VALUE，忽略注释与空行），足够脚本做预检。
        应用本身用 pydantic-settings 解析，不依赖这里。
    #>
    param([Parameter(Mandatory = $true)][string]$Key)

    if (-not (Test-Path $script:EnvFile)) { return $null }
    foreach ($line in (Get-Content $script:EnvFile -Encoding UTF8)) {
        $trimmed = $line.Trim()
        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
        $index = $trimmed.IndexOf("=")
        if ($index -lt 1) { continue }
        if ($trimmed.Substring(0, $index).Trim() -eq $Key) {
            return $trimmed.Substring($index + 1).Trim()
        }
    }
    return $null
}

function Test-DatabaseUrl {
    <#
        .SYNOPSIS
        用给定的连接串真正连一次数据库。返回 @{ Success; Detail }。

        .DESCRIPTION
        写 .env 之前先验证，避免把填错的值落盘 —— 否则错误要等到跑迁移时才
        以 "failed to resolve host" 之类的形式暴露，而且此时 .env 已经是坏的。

        连接串通过环境变量传给子进程，不作为命令行参数：命令行可被同机其他
        进程从进程列表读到，里面含口令。
    #>
    param(
        [Parameter(Mandatory = $true)][string]$DatabaseUrl,
        [Parameter(Mandatory = $true)][string]$PythonExe
    )

    if (-not (Test-Path $PythonExe)) {
        return @{ Success = $false; Detail = "找不到 Python: $PythonExe" }
    }

    $probe = @'
import asyncio, os, sys
asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def main():
    engine = create_async_engine(os.environ["ZWT_PROBE_URL"])
    try:
        async with engine.connect() as conn:
            db = await conn.scalar(text("SELECT current_database()"))
            usr = await conn.scalar(text("SELECT current_user"))
            ver = await conn.scalar(text("SHOW server_version"))
        print(f"OK|PostgreSQL {ver}, database={db}, user={usr}")
    except Exception as exc:
        first = str(exc).strip().splitlines()[0]
        print(f"FAIL|{type(exc).__name__}: {first[:200]}")
        sys.exit(1)
    finally:
        await engine.dispose()

asyncio.run(main())
'@

    $env:ZWT_PROBE_URL = $DatabaseUrl
    try {
        $output = $probe | & $PythonExe - 2>&1
    } finally {
        Remove-Item Env:\ZWT_PROBE_URL -ErrorAction SilentlyContinue
    }

    $line = @($output | Where-Object { $_ -match '^(OK|FAIL)\|' } | Select-Object -Last 1)
    if ($line.Count -eq 0) {
        return @{ Success = $false; Detail = "探测脚本无输出（Python 环境异常？）" }
    }
    $parts = $line[0] -split '\|', 2
    return @{ Success = ($parts[0] -eq "OK"); Detail = $parts[1] }
}

function Show-PostgresStartFailure {
    <#
        .SYNOPSIS
        服务起不来时，把真正的原因打出来。

        .DESCRIPTION
        Start-Service 只会说 "Failed to start service"，毫无信息量。
        PostgreSQL 启动失败的真实原因在两个地方：数据目录下的 log（如果进程
        活到了能开日志收集器的时候），以及 Windows 应用程序事件日志（进程在
        更早阶段就退出时只有这里有，例如配置文件解析失败）。
    #>
    param(
        [Parameter(Mandatory = $true)][string]$DataDirectory,
        [datetime]$Since = (Get-Date).AddMinutes(-5)
    )

    Write-Host ""
    Write-Host "    --- PostgreSQL 启动失败详情 ---" -ForegroundColor Yellow

    $logDir = Join-Path $DataDirectory "log"
    $logged = $false
    if (Test-Path $logDir) {
        $latest = @(Get-ChildItem $logDir -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1)
        if ($latest.Count -gt 0) {
            Write-Host "    集群日志 $($latest[0].Name):"
            Get-Content $latest[0].FullName -Tail 15 -ErrorAction SilentlyContinue |
                ForEach-Object { Write-Host "      $_" }
            $logged = $true
        }
    }
    if (-not $logged) {
        Write-Host "    集群日志目录为空 —— 进程在开启日志收集器之前就退出了。"
    }

    try {
        $events = @(Get-WinEvent -FilterHashtable @{LogName = "Application"; StartTime = $Since} -ErrorAction Stop |
            Where-Object { $_.ProviderName -like "*PostgreSQL*" } | Select-Object -First 6)
        if ($events.Count -gt 0) {
            Write-Host "    Windows 应用程序日志:"
            foreach ($e in $events) {
                foreach ($line in (($e.Message -split "`n") | Where-Object { $_.Trim() -ne "" } | Select-Object -First 2)) {
                    Write-Host "      $($line.Trim())"
                }
            }
        }
    } catch {
        Write-Host "    （读取事件日志失败，可手动查看：事件查看器 > Windows 日志 > 应用程序）"
    }
    Write-Host ""
}

function Get-ZwtPostgresPort {
    <#
        .SYNOPSIS
        探测 ZWT 专用 PostgreSQL 实例的端口。找不到该实例时返回 $null。

        .DESCRIPTION
        从服务的 PathName 里取出 -D 指定的数据目录，再读该目录的
        postgresql.conf。这样即使建集群时用了非默认端口也能正确探到，
        不必让人手动记住填哪个数字 —— 填错端口会连到 BOI 的实例上去。
    #>
    param([string]$ServiceName = "postgresql-zwt15")

    $svc = Get-CimInstance Win32_Service -Filter "Name = '$ServiceName'" -ErrorAction SilentlyContinue
    if ($null -eq $svc) { return $null }
    if ($svc.PathName -notmatch '-D\s+"([^"]+)"') { return $null }

    $conf = Join-Path $Matches[1] "postgresql.conf"
    if (-not (Test-Path $conf)) { return $null }

    # 取最后一条生效的 port 设置：postgresql.conf 后面的赋值覆盖前面的，
    # 而建集群脚本是把 port 追加到文件末尾的。
    $port = $null
    foreach ($line in (Get-Content $conf -Encoding UTF8)) {
        if ($line -match '^\s*port\s*=\s*(\d+)') { $port = [int]$Matches[1] }
    }
    return $port
}

function Get-DatabasePortFromEnv {
    <#
        .SYNOPSIS
        从 .env 的 ZWT_DATABASE_URL 里抽出端口号。取不到返回 $null。
    #>
    $url = Get-EnvValue -Key "ZWT_DATABASE_URL"
    if ([string]::IsNullOrWhiteSpace($url)) { return $null }
    # postgresql+psycopg://user:pass@host:port/dbname
    if ($url -match '@[^/:]+:(\d+)/') { return [int]$Matches[1] }
    return $null
}

function Show-PostgresStatus {
    <#
        .SYNOPSIS
        报告 .env 指向的那个端口上到底是哪个 PostgreSQL 实例。

        .DESCRIPTION
        本机有多个 PostgreSQL 实例，端口各不相同：
          postgresql-x64-18   5432   只有系统库
          postgresql-x64-15   5434   BOI 的实例
          postgresql-zwt15    5435   ZWT 专用（由 Initialize-ZwtPostgres.ps1 建立）

        它们端口不冲突，可以共存。真正的风险不是"版本不对"，而是 .env 指到了
        错误的实例 —— 尤其是指到 BOI 的 5434 上去。所以这里按 .env 里实际配置
        的端口来判断，而不是假定某个版本才是对的。
    #>
    $services = @(Get-CimInstance Win32_Service -Filter "Name LIKE '%postgres%'" -ErrorAction SilentlyContinue)
    if ($services.Count -eq 0) {
        Write-Warn "未发现 PostgreSQL 服务。"
        return
    }
    foreach ($svc in $services) {
        $mark = if ($svc.State -eq "Running") { "运行中" } else { "已停止" }
        Write-Host "    PostgreSQL 实例: $($svc.Name) [$mark]"
    }

    $dbPort = Get-DatabasePortFromEnv
    if ($null -eq $dbPort) {
        Write-Warn "无法从 .env 解析出数据库端口，跳过实例核对。"
        return
    }

    $owner = Get-PortOwner -Port $dbPort
    if ($null -eq $owner) {
        Write-Err ".env 指向端口 $dbPort，但该端口上没有服务在监听 —— 后端会无法就绪。"
        return
    }
    Write-Ok ".env 指向端口 $dbPort，该端口有服务在监听"

    # 指到 BOI 的实例上是最需要当场拦住的情况：项目边界明确要求
    # 不读取或写入 BOI 数据库。
    $boiService = Get-CimInstance Win32_Service -Filter "Name = 'postgresql-x64-15'" -ErrorAction SilentlyContinue
    if ($null -ne $boiService -and $boiService.State -eq "Running") {
        $boiPort = 5434
        if ($dbPort -eq $boiPort) {
            Write-Warn "注意：端口 $dbPort 是 BOI 实例 (postgresql-x64-15) 的端口。"
            Write-Warn "项目边界要求 ZWT 不使用 BOI 的数据库实例，请确认这是有意为之。"
        }
    }
}
