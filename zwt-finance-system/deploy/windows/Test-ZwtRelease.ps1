[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CurrentRoot,

    [Parameter(Mandatory = $true)]
    [uri]$ReadyUrl,

    [ValidateRange(1, 120)]
    [int]$TimeoutSeconds = 20
)

$ErrorActionPreference = "Stop"
$currentFull = (Resolve-Path -LiteralPath $CurrentRoot).Path
$requiredFiles = @(
    "release-manifest.json",
    "frontend\dist\index.html",
    "backend\.venv\Scripts\python.exe",
    "backend\app\assets\templates\WHT-Template.pdf",
    "backend\app\assets\fonts\Sarabun-Regular.ttf"
)

foreach ($relativeFile in $requiredFiles) {
    $filePath = Join-Path $currentFull $relativeFile
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        throw "Activated release is missing required file: $relativeFile"
    }
}

$manifest = Get-Content -LiteralPath (
    Join-Path $currentFull "release-manifest.json"
) -Raw | ConvertFrom-Json

$response = Invoke-RestMethod `
    -Method Get `
    -Uri $ReadyUrl `
    -TimeoutSec $TimeoutSeconds

if ($response.status -ne "ready" -or $response.database -ne "ok") {
    throw "API/PostgreSQL readiness check failed at $ReadyUrl"
}

[pscustomobject]@{
    ReleaseId = $manifest.ReleaseId
    Commit = $manifest.Commit
    CurrentRoot = $currentFull
    ApiReady = $true
    DatabaseReady = $true
    CheckedAt = (Get-Date).ToString("o")
} | ConvertTo-Json -Depth 3
