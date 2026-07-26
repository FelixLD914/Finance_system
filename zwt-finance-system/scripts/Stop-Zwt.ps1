<#
.SYNOPSIS
    停止 ZWT 财务系统的开发进程。

.DESCRIPTION
    按端口找到进程并停止。只会停掉命令行里包含 zwt-finance-system 的进程 ——
    端口上如果是别的程序（例如 BOI），一律不动，只报告。

.PARAMETER Force
    端口被非本项目进程占用时也强制停止。默认不启用，避免误杀 BOI 的服务。

.EXAMPLE
    .\Stop-Zwt.ps1
#>
[CmdletBinding()]
param(
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_ZwtCommon.ps1")

$targets = @(
    @{ Port = $script:ZwtApiPort;     Label = "后端" },
    @{ Port = $script:ZwtDevPort;     Label = "前端 dev" },
    @{ Port = $script:ZwtPreviewPort; Label = "前端 preview" }
)

$stopped = 0
foreach ($target in $targets) {
    $owner = Get-PortOwner -Port $target.Port
    if ($null -eq $owner) {
        Write-Host "    $($target.Label) (:$($target.Port)) 未运行"
        continue
    }

    $isOurs = $owner.CommandLine -like "*zwt-finance-system*"
    if (-not $isOurs -and -not $Force) {
        # 不属于本项目的进程一律不碰：这个端口上出现别的东西时，
        # 盲目 kill 有可能打断 BOI 或其他人的工作。
        Write-Warn "$($target.Label) (:$($target.Port)) 上的进程不属于本项目，已跳过"
        Write-Warn "  PID $($owner.ProcessId)  $($owner.Name)"
        Write-Warn "  确实要停止请加 -Force"
        continue
    }

    Write-Step "停止 $($target.Label) (PID $($owner.ProcessId), 端口 $($target.Port))"
    try {
        Stop-Process -Id $owner.ProcessId -Force -ErrorAction Stop
        $stopped++
        Write-Ok "已停止"
    } catch {
        Write-Err "停止失败: $($_.Exception.Message)"
    }
}

Write-Host ""
if ($stopped -gt 0) {
    Write-Host "已停止 $stopped 个进程" -ForegroundColor Green
} else {
    Write-Host "没有需要停止的进程"
}
