<#
.SYNOPSIS
    一键启动 ZWT 财务系统开发环境（后端 + 前端）。

.DESCRIPTION
    默认在各自的 PowerShell 窗口里启动后端与前端，等待健康检查通过后打开浏览器。
    首次使用请先运行 .\Initialize-ZwtDev.ps1 完成依赖安装与数据库迁移。

    端口：前端 5273 / 后端 8100。启动前会确认本项目没有占用 BOI 的
    5173 / 4173 / 8000。

.PARAMETER BackendOnly
    只启动后端。

.PARAMETER FrontendOnly
    只启动前端（需要后端已在运行，否则 /api 代理会失败）。

.PARAMETER NoBrowser
    启动完成后不自动打开浏览器。

.PARAMETER Recreate
    端口已被本项目旧进程占用时，先停掉再启动。

.EXAMPLE
    .\Start-Zwt.ps1
    .\Start-Zwt.ps1 -BackendOnly
    .\Start-Zwt.ps1 -Recreate -NoBrowser
#>
[CmdletBinding()]
param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$NoBrowser,
    [switch]$Recreate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_ZwtCommon.ps1")

if ($BackendOnly -and $FrontendOnly) {
    throw "-BackendOnly 与 -FrontendOnly 不能同时使用"
}

$startBackend = -not $FrontendOnly
$startFrontend = -not $BackendOnly

Write-Step "预检"

# 必须用 @() 包住：函数返回空数组时 PowerShell 会把它解包成 $null，
# StrictMode 下 $null.Count 直接抛 PropertyNotFoundStrict。
# 也就是说"一切就绪"反而是会崩的那条路径。
$missing = @(Test-Prerequisites)
if ($missing.Count -gt 0) {
    Write-Err "开发环境尚未初始化："
    foreach ($item in $missing) { Write-Err "  - $item" }
    Write-Host ""
    Write-Host "请先运行： .\scripts\Initialize-ZwtDev.ps1" -ForegroundColor Yellow
    exit 1
}
Write-Ok ".env、后端虚拟环境、前端依赖均已就绪"

# 本项目绝不能占用 BOI 的端口，这是启动前的硬性检查。
Assert-BoiPortsUntouched
Write-Ok "BOI 保留端口 (5173/4173/8000) 未被本项目占用"

if ($startBackend) { Show-PostgresStatus }

# 端口占用处理
$targets = @()
if ($startBackend)  { $targets += @{ Port = $script:ZwtApiPort; Label = "后端" } }
if ($startFrontend) { $targets += @{ Port = $script:ZwtDevPort; Label = "前端" } }

foreach ($target in $targets) {
    $owner = Get-PortOwner -Port $target.Port
    if ($null -eq $owner) { continue }

    $isOurs = $owner.CommandLine -like "*zwt-finance-system*"
    if ($isOurs -and $Recreate) {
        Write-Warn "$($target.Label)端口 $($target.Port) 被旧进程占用 (PID $($owner.ProcessId))，正在停止"
        Stop-Process -Id $owner.ProcessId -Force
        Start-Sleep -Milliseconds 800
        continue
    }
    if ($isOurs) {
        Write-Warn "$($target.Label)已在运行 (PID $($owner.ProcessId), 端口 $($target.Port))，跳过启动"
        Write-Warn "要重启请加 -Recreate"
        if ($target.Label -eq "后端")  { $startBackend = $false }
        if ($target.Label -eq "前端")  { $startFrontend = $false }
        continue
    }
    # 端口被别的程序占用：vite 设了 strictPort，后端也会直接绑定失败，
    # 与其让它们各自报一句晦涩的错，不如在这里说清楚是谁占着。
    Write-Err "$($target.Label)端口 $($target.Port) 被其他程序占用："
    Write-Err "  PID $($owner.ProcessId)  $($owner.Name)"
    Write-Err "  $($owner.CommandLine)"
    exit 1
}

function Start-InNewWindow {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Command
    )
    # 各起一个窗口，日志直接可见 —— 开发期排错比后台静默有用得多。
    $inner = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkingDirectory'; $Command"
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoExit", "-NoProfile", "-Command", $inner) `
        -WorkingDirectory $WorkingDirectory | Out-Null
}

if ($startBackend) {
    Write-Step "启动后端 (127.0.0.1:$script:ZwtApiPort)"
    Start-InNewWindow -Title "ZWT 后端 :$script:ZwtApiPort" `
        -WorkingDirectory $script:BackendRoot `
        -Command ".\.venv\Scripts\python.exe -m app.run_windows"

    # 用 /ready 而不是 /live：前者会真的执行一次 SELECT 1，
    # 能把"进程起来了但连不上库"这种情况在这里就暴露出来。
    $readyUrl = "http://127.0.0.1:$script:ZwtApiPort/api/health/ready"
    if (Wait-ForHttp -Url $readyUrl -TimeoutSeconds 60) {
        Write-Ok "后端就绪（数据库连接正常）"
    } else {
        Write-Err "后端在 60 秒内未就绪。请查看后端窗口的错误输出。"
        Write-Err "常见原因：ZWT_DATABASE_URL 配置错误、PostgreSQL 未启动、迁移未执行。"
        exit 1
    }
}

if ($startFrontend) {
    Write-Step "启动前端 (127.0.0.1:$script:ZwtDevPort)"
    Start-InNewWindow -Title "ZWT 前端 :$script:ZwtDevPort" `
        -WorkingDirectory $script:FrontendRoot `
        -Command "npm.cmd run dev"

    if (Wait-ForPort -Port $script:ZwtDevPort -TimeoutSeconds 90) {
        Write-Ok "前端已监听 $script:ZwtDevPort"
    } else {
        Write-Err "前端在 90 秒内未监听 $script:ZwtDevPort。请查看前端窗口的错误输出。"
        exit 1
    }
}

# 启动后复查一次：确认整个过程没有把 BOI 的端口占掉。
Assert-BoiPortsUntouched

Write-Host ""
Write-Host "ZWT 财务系统已启动" -ForegroundColor Green
Write-Host "  前端  http://127.0.0.1:$script:ZwtDevPort"
Write-Host "  后端  http://127.0.0.1:$script:ZwtApiPort/api/docs"
Write-Host ""
Write-Host "停止： .\scripts\Stop-Zwt.ps1"

if ($startFrontend -and -not $NoBrowser) {
    Start-Process "http://127.0.0.1:$script:ZwtDevPort" | Out-Null
}
