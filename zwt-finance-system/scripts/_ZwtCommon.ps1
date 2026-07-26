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

function Show-PostgresStatus {
    <#
        .SYNOPSIS
        提示 5432 上实际运行的 PostgreSQL 版本。

        .DESCRIPTION
        本机同时装了 PG 15 和 PG 18，两者都想用 5432。项目基线是 PG 15，
        但连上去的其实是当前占用 5432 的那一个 —— 版本不符时数据会写错地方，
        所以启动前把实际情况打出来。
    #>
    $services = Get-CimInstance Win32_Service -Filter "Name LIKE '%postgres%'" -ErrorAction SilentlyContinue
    if ($null -eq $services) {
        Write-Warn "未发现 PostgreSQL 服务。"
        return
    }
    $running = @($services | Where-Object { $_.State -eq "Running" })
    if ($running.Count -eq 0) {
        Write-Err "没有正在运行的 PostgreSQL 服务，后端将无法就绪。"
        return
    }
    foreach ($svc in $running) {
        Write-Ok "PostgreSQL 运行中: $($svc.Name)"
    }
    if (@($running | Where-Object { $_.Name -like "*15*" }).Count -eq 0) {
        Write-Warn "项目基线是 PostgreSQL 15，但当前运行的不是 15。"
        Write-Warn "确认 .env 的 ZWT_DATABASE_URL 指向的确实是预期的实例。"
    }
}
