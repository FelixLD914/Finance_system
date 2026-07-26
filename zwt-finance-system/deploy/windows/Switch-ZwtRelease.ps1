[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9A-Za-z._-]+$")]
    [string]$ReleaseId,

    [string]$ApiServiceName = "ZWTFinanceApi"
)

$ErrorActionPreference = "Stop"
$installFull = [System.IO.Path]::GetFullPath($InstallRoot)
$releaseRoot = Join-Path (Join-Path $installFull "releases") $ReleaseId
$current = Join-Path $installFull "current"
$next = Join-Path $installFull "current.next"
$previous = Join-Path $installFull "current.previous"

if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot "release-manifest.json"))) {
    throw "The target release has not passed Build-ZwtRelease.ps1: $releaseRoot"
}
if (-not $releaseRoot.StartsWith((Join-Path $installFull "releases"))) {
    throw "Resolved release target escaped the configured releases directory."
}

$service = Get-Service -Name $ApiServiceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne "Stopped") {
    Stop-Service -Name $ApiServiceName -ErrorAction Stop
    $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
}

try {
    if (Test-Path -LiteralPath $next) {
        Remove-Item -LiteralPath $next -Force
    }
    New-Item -ItemType Junction -Path $next -Target $releaseRoot | Out-Null

    if (Test-Path -LiteralPath $previous) {
        Remove-Item -LiteralPath $previous -Force
    }
    if (Test-Path -LiteralPath $current) {
        Rename-Item -LiteralPath $current -NewName "current.previous"
    }
    Rename-Item -LiteralPath $next -NewName "current"
}
catch {
    if (-not (Test-Path -LiteralPath $current) -and (Test-Path -LiteralPath $previous)) {
        Rename-Item -LiteralPath $previous -NewName "current"
    }
    throw
}
finally {
    if ($service) {
        Start-Service -Name $ApiServiceName
    }
}

Write-Output "Current release switched to $ReleaseId"

