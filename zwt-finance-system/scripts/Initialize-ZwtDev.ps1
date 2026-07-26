<#
.SYNOPSIS
    首次部署：安装依赖、生成 .env、执行数据库迁移、引导创建管理员账号。

.DESCRIPTION
    可重复执行 —— 已完成的步骤会跳过。完成后用 .\Start-Zwt.ps1 启动。

    口令始终由你在提示符下输入，脚本不接受口令参数：命令行会进入 PowerShell
    历史记录，在 Windows 上还能被其他进程从进程列表读到。

.PARAMETER SkipInstall
    跳过依赖安装（venv / npm），只做 .env 与迁移。

.EXAMPLE
    .\Initialize-ZwtDev.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_ZwtCommon.ps1")

Write-Host ""
Write-Host "ZWT 财务系统 — 开发环境初始化" -ForegroundColor Cyan
Write-Host ""

# --- 1. .env -----------------------------------------------------------------

Write-Step "检查 .env"
if (Test-Path $script:EnvFile) {
    Write-Ok ".env 已存在，跳过（要重建请先手动删除）"
} else {
    if (-not (Test-Path $script:EnvExample)) {
        throw "找不到 .env.example: $script:EnvExample"
    }

    Show-PostgresStatus
    Write-Host ""
    Write-Host "    需要 zwt_finance 数据库的连接信息。" -ForegroundColor Yellow

    $dbHost = Read-Host "    数据库主机 [127.0.0.1]"
    if ([string]::IsNullOrWhiteSpace($dbHost)) { $dbHost = "127.0.0.1" }

    $dbPort = Read-Host "    数据库端口 [5432]"
    if ([string]::IsNullOrWhiteSpace($dbPort)) { $dbPort = "5432" }

    $dbName = Read-Host "    数据库名 [zwt_finance]"
    if ([string]::IsNullOrWhiteSpace($dbName)) { $dbName = "zwt_finance" }

    $dbUser = Read-Host "    数据库用户 [zwt_finance_app]"
    if ([string]::IsNullOrWhiteSpace($dbUser)) { $dbUser = "zwt_finance_app" }

    # -AsSecureString：输入不回显，也不会进入 PowerShell 历史。
    $securePassword = Read-Host "    数据库口令" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }

    # 口令里的 @ / : / / 会破坏 URL 结构，必须百分号编码。
    $encodedUser = [uri]::EscapeDataString($dbUser)
    $encodedPassword = [uri]::EscapeDataString($plainPassword)
    $databaseUrl = "postgresql+psycopg://${encodedUser}:${encodedPassword}@${dbHost}:${dbPort}/${dbName}"

    $lines = Get-Content $script:EnvExample -Encoding UTF8
    $output = foreach ($line in $lines) {
        if ($line -match '^\s*ZWT_DATABASE_URL\s*=') {
            "ZWT_DATABASE_URL=$databaseUrl"
        } elseif ($line -match '^\s*#\s*ZWT_SESSION_COOKIE_SECURE\s*=') {
            # 开发期走 http://127.0.0.1:5273，Secure Cookie 不会被浏览器回传，
            # 不显式关掉的话登录后立刻又被当成未登录。
            "ZWT_SESSION_COOKIE_SECURE=false"
        } else {
            $line
        }
    }
    Set-Content -Path $script:EnvFile -Value $output -Encoding UTF8
    $plainPassword = $null

    Write-Ok "已生成 .env（该文件在 .gitignore 中，不会进入版本库）"
}

# --- 2. 后端依赖 --------------------------------------------------------------

if (-not $SkipInstall) {
    Write-Step "后端虚拟环境"
    if (Test-Path $script:VenvPython) {
        Write-Ok "已存在，跳过"
    } else {
        Write-Host "    正在创建 venv 并安装依赖（需要几分钟）..."
        Push-Location $script:BackendRoot
        try {
            & py -m venv .venv
            if ($LASTEXITCODE -ne 0) { throw "创建 venv 失败" }
            & $script:VenvPython -m pip install --upgrade pip --quiet
            & $script:VenvPython -m pip install -e ".[dev]" --quiet
            if ($LASTEXITCODE -ne 0) { throw "安装后端依赖失败" }
        } finally {
            Pop-Location
        }
        Write-Ok "后端依赖安装完成"
    }

    Write-Step "前端依赖"
    $nodeModules = Join-Path $script:FrontendRoot "node_modules"
    if (Test-Path $nodeModules) {
        Write-Ok "已存在，跳过"
    } else {
        Push-Location $script:FrontendRoot
        try {
            & npm.cmd install --cache .npm-cache
            if ($LASTEXITCODE -ne 0) { throw "安装前端依赖失败" }
        } finally {
            Pop-Location
        }
        Write-Ok "前端依赖安装完成"
    }
}

# --- 3. 数据库迁移 ------------------------------------------------------------

Write-Step "数据库迁移"
Push-Location $script:BackendRoot
try {
    & $script:VenvPython -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) {
        Write-Err "迁移失败。请确认 .env 的 ZWT_DATABASE_URL 正确、PostgreSQL 已启动、"
        Write-Err "且 zwt_finance 数据库与账号已建好。"
        exit 1
    }
} finally {
    Pop-Location
}
Write-Ok "已升级到最新版本"

# --- 4. 管理员账号 ------------------------------------------------------------

Write-Step "管理员账号"

# 直接查库判断有没有用户，避免"已经建过了还提示再建一次"。
Push-Location $script:BackendRoot
try {
    $userCount = & $script:VenvPython -c @"
import asyncio, sys
from sqlalchemy import func, select
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
from app.core.database import SessionFactory
from app.core.models import User

async def main():
    async with SessionFactory() as session:
        print(await session.scalar(select(func.count()).select_from(User)))

asyncio.run(main())
"@
} finally {
    Pop-Location
}

if ($LASTEXITCODE -ne 0) {
    Write-Warn "无法查询用户数，请手动确认。"
    $userCount = "0"
}

if ([int]$userCount -gt 0) {
    Write-Ok "已存在 $userCount 个账号，跳过创建"
} else {
    Write-Host ""
    Write-Host "    数据库中还没有任何账号。鉴权已生效，没有账号将无法登录。" -ForegroundColor Yellow
    Write-Host "    接下来会提示输入管理员口令（不回显，至少 12 位）。" -ForegroundColor Yellow
    Write-Host ""
    $displayName = Read-Host "    管理员显示名（会出现在审计记录里）[系统管理员]"
    if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = "系统管理员" }
    $username = Read-Host "    管理员用户名 [admin]"
    if ([string]::IsNullOrWhiteSpace($username)) { $username = "admin" }

    Push-Location $script:BackendRoot
    try {
        & $script:VenvPython -m app.cli create-user --username $username --role admin --display-name $displayName
        if ($LASTEXITCODE -ne 0) {
            Write-Err "创建账号失败。可稍后手动执行："
            Write-Err "  .\.venv\Scripts\python.exe -m app.cli create-user --username admin --role admin"
            exit 1
        }
    } finally {
        Pop-Location
    }
    Write-Ok "管理员账号已创建"
}

Write-Host ""
Write-Host "初始化完成。" -ForegroundColor Green
Write-Host "  启动： .\scripts\Start-Zwt.ps1"
Write-Host ""
