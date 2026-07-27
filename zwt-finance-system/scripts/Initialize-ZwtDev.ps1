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

# 这个脚本不需要管理员权限。以管理员身份跑会让 npm install 写出的
# node_modules 归属 Administrators，之后普通用户改不动。
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    Write-Warn "当前是管理员窗口。本脚本不需要提权，建议改用普通 PowerShell 运行，"
    Write-Warn "否则 npm install 产生的文件会归 Administrators 所有。"
    Write-Warn "（只有 Initialize-ZwtPostgres.ps1 需要管理员权限。）"
    $goOn = Read-Host "    仍要继续？(y/N)"
    if ($goOn -ne "y") { Write-Host "    已取消。"; exit 0 }
    Write-Host ""
}

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
    Write-Host "    方括号里是默认值 —— 除口令外，全部直接按回车即可。" -ForegroundColor Yellow
    Write-Host "    这里填的不是 Windows 账号，也不是服务名。" -ForegroundColor Yellow
    Write-Host ""

    $dbHost = Read-Host "    数据库主机（回车用 127.0.0.1）"
    if ([string]::IsNullOrWhiteSpace($dbHost)) { $dbHost = "127.0.0.1" }

    # 自动探测 ZWT 专用实例的端口。手填端口最容易出的错是填成 5432 或 5434，
    # 前者是空实例、后者是 BOI 的实例 —— 都不该连。
    $detectedPort = Get-ZwtPostgresPort
    if ($null -ne $detectedPort) {
        Write-Ok "已探测到 ZWT 专用实例 postgresql-zwt15，端口 $detectedPort"
        $defaultPort = "$detectedPort"
    } else {
        Write-Warn "未发现 ZWT 专用实例 postgresql-zwt15。"
        Write-Warn "若尚未建立，请先以管理员身份运行 Initialize-ZwtPostgres.ps1。"
        Write-Warn "注意 5432 是空实例、5434 是 BOI 的实例，都不应作为 ZWT 的库。"
        $defaultPort = "5435"
    }

    $dbPort = Read-Host "    数据库端口（回车用 $defaultPort）"
    if ([string]::IsNullOrWhiteSpace($dbPort)) { $dbPort = $defaultPort }
    if ($dbPort -eq "5434") {
        Write-Warn "5434 是 BOI 实例的端口。项目边界要求 ZWT 不使用 BOI 的数据库实例。"
        $confirmBoi = Read-Host "    确定要继续吗？(y/N)"
        if ($confirmBoi -ne "y") { Write-Host "    已取消。"; exit 0 }
    }

    $dbName = Read-Host "    数据库名（回车用 zwt_finance）"
    if ([string]::IsNullOrWhiteSpace($dbName)) { $dbName = "zwt_finance" }

    $dbUser = Read-Host "    数据库角色名（回车用 zwt_finance_app）"
    if ([string]::IsNullOrWhiteSpace($dbUser)) { $dbUser = "zwt_finance_app" }

    # 连接测试通过后才写 .env。此前是直接写盘，填错的值要等到跑迁移时才以
    # "failed to resolve host" 之类的报错暴露出来，而且 .env 已经留下坏数据。
    $databaseUrl = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        # -AsSecureString：输入不回显，也不会进入 PowerShell 历史。
        $securePassword = Read-Host "    $dbUser 的口令" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        try {
            $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }

        # 口令与角色名里的 @ / : / / 会破坏 URL 结构，必须百分号编码。
        $candidate = "postgresql+psycopg://$([uri]::EscapeDataString($dbUser)):$([uri]::EscapeDataString($plainPassword))@${dbHost}:${dbPort}/${dbName}"
        $plainPassword = $null

        Write-Host "    正在验证连接..."
        $probe = Test-DatabaseUrl -DatabaseUrl $candidate -PythonExe $script:VenvPython
        if ($probe.Success) {
            Write-Ok "连接成功：$($probe.Detail)"
            $databaseUrl = $candidate
            break
        }

        Write-Err "连接失败：$($probe.Detail)"
        $candidate = $null
        if ($attempt -lt 3) {
            Write-Warn "请确认主机 / 端口 / 库名 / 角色名 / 口令后重试（第 $attempt 次）。"
            Write-Warn "当前使用：$dbUser@${dbHost}:${dbPort}/${dbName}"
        }
    }

    if ($null -eq $databaseUrl) {
        Write-Err "连接始终失败，未写入 .env。"
        Write-Err "若尚未建立 ZWT 专用实例，请先以管理员身份运行 Initialize-ZwtPostgres.ps1。"
        exit 1
    }

    $lines = Get-Content $script:EnvExample
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
    # 必须无 BOM：python-dotenv 按 utf-8 读取但不剥 BOM，带 BOM 会让第一个键
    # 变成 "﻿ZWT_ENVIRONMENT" 而静默失效。
    Write-TextFileNoBom -Path $script:EnvFile -Lines $output
    $plainPassword = $null

    Write-Ok "已生成 .env（无 BOM；该文件在 .gitignore 中，不会进入版本库）"
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

# --- 3. 运行期目录与模板 ------------------------------------------------------

Write-Step "运行期目录与模板"

# ZWT_ATTACHMENT_ROOT 不存在的话，第一次导入或生成文件就会失败。
# 这个目录不在仓库里（.gitignore 排除 attachments/），必须部署时建。
$paths = & $script:VenvPython -c @"
from app.core.config import get_settings
s = get_settings()
print(s.attachment_root)
print(s.wht_template_path)
print(s.tax_invoice_template_path)
"@
if ($LASTEXITCODE -ne 0) {
    Write-Err "无法读取配置，请检查 .env"
    exit 1
}
$attachmentRoot, $whtTemplate, $taxTemplate = $paths -split "`r?`n" | Where-Object { $_.Trim() -ne "" }

if (Test-Path $attachmentRoot) {
    Write-Ok "附件目录已存在: $attachmentRoot"
} else {
    New-Item -ItemType Directory -Path $attachmentRoot -Force | Out-Null
    Write-Ok "已创建附件目录: $attachmentRoot"
}

# 模板是业务方批准的正式版式，脚本不代为生成，只检查并给出出处。
$legacyRoot = Join-Path (Split-Path -Parent $script:ZwtRoot) "Sample_previous_code"
$templateChecks = @(
    @{ Path = $whtTemplate; Label = "WHT Excel 模板";     Legacy = Join-Path $legacyRoot "WHT\Template.xlsx" },
    @{ Path = $taxTemplate; Label = "TAX INV Excel 模板"; Legacy = Join-Path $legacyRoot "TAX INV\template.xlsx" }
)
foreach ($check in $templateChecks) {
    if (Test-Path $check.Path) {
        Write-Ok "$($check.Label)已就位"
        continue
    }
    $dir = Split-Path -Parent $check.Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Write-Warn "$($check.Label)缺失: $($check.Path)"
    if (Test-Path $check.Legacy) {
        Write-Warn "旧系统里有一份: $($check.Legacy)"
        $copyIt = Read-Host "    复制过来？(y/N)"
        if ($copyIt -eq "y") {
            Copy-Item $check.Legacy $check.Path -Force
            Write-Ok "已复制。请与业务方确认这是当前批准的版式。"
        } else {
            Write-Warn "跳过。缺少模板时该模块的文件生成会失败。"
        }
    } else {
        Write-Warn "请向业务方索取批准的模板并放到上述路径。"
    }
}

# --- 4. 数据库迁移 ------------------------------------------------------------

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

# --- 5. 管理员账号 ------------------------------------------------------------

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
