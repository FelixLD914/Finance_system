[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,

    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9A-Za-z._-]+$")]
    [string]$ReleaseId,

    [Parameter(Mandatory = $true)]
    [string]$NodeExe,

    [Parameter(Mandatory = $true)]
    [string]$PythonExe
)

$ErrorActionPreference = "Stop"
$sourceFull = (Resolve-Path -LiteralPath $SourceRoot).Path
$installFull = [System.IO.Path]::GetFullPath($InstallRoot)
$releasesRoot = Join-Path $installFull "releases"
$releaseRoot = Join-Path $releasesRoot $ReleaseId
$npmCache = Join-Path $installFull "cache\npm"
$pipCache = Join-Path $installFull "cache\pip"

if (Test-Path -LiteralPath $releaseRoot) {
    throw "Release directory already exists: $releaseRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceFull "frontend\package-lock.json"))) {
    throw "Frontend package-lock.json is required."
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceFull "backend\requirements.lock"))) {
    throw "Backend requirements.lock is required."
}
$requiredSourceAssets = @(
    "backend\app\assets\templates\WHT-Template.pdf",
    "backend\app\assets\templates\TAX-INV-Template.pdf",
    "backend\app\assets\fonts\Sarabun-Regular.ttf"
)
foreach ($relativeAsset in $requiredSourceAssets) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceFull $relativeAsset) -PathType Leaf)) {
        throw "Required PDF runtime asset is missing: $relativeAsset"
    }
}

$nodeVersion = (& $NodeExe --version).TrimStart("v")
$nodeParts = $nodeVersion.Split(".")
$nodeValid = (
    ([int]$nodeParts[0] -gt 22) -or
    ([int]$nodeParts[0] -eq 22 -and [int]$nodeParts[1] -ge 12)
)
if (-not $nodeValid) {
    throw "Vite 8 requires Node >=22.12.0; selected Node is $nodeVersion"
}

$npmCmd = Join-Path (Split-Path -Parent $NodeExe) "npm.cmd"
if (-not (Test-Path -LiteralPath $npmCmd)) {
    throw "npm.cmd was not found beside the selected Node executable."
}

New-Item -ItemType Directory -Path $releaseRoot, $npmCache, $pipCache -Force | Out-Null
& robocopy.exe $sourceFull $releaseRoot /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 `
    /XD node_modules dist .venv .npm-cache .pip-cache output `
    /XF .env
if ($LASTEXITCODE -ge 8) {
    throw "Source copy failed with robocopy exit code $LASTEXITCODE"
}

Push-Location (Join-Path $releaseRoot "frontend")
try {
    & $npmCmd ci --cache $npmCache
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
    & $npmCmd test
    if ($LASTEXITCODE -ne 0) { throw "frontend tests failed" }
    & $npmCmd run build
    if ($LASTEXITCODE -ne 0) { throw "frontend production build failed" }
}
finally {
    Pop-Location
}

$backendRoot = Join-Path $releaseRoot "backend"
$venvRoot = Join-Path $backendRoot ".venv"
& $PythonExe -m venv $venvRoot
if ($LASTEXITCODE -ne 0) { throw "Python venv creation failed" }
$releasePython = Join-Path $venvRoot "Scripts\python.exe"
& $releasePython -m pip install --cache-dir $pipCache -r (Join-Path $backendRoot "requirements.lock")
if ($LASTEXITCODE -ne 0) { throw "backend locked dependency install failed" }
& $releasePython -m pip install --no-build-isolation --no-deps $backendRoot
if ($LASTEXITCODE -ne 0) { throw "backend package install failed" }
& $releasePython -m compileall -q (Join-Path $backendRoot "app")
if ($LASTEXITCODE -ne 0) { throw "backend compile validation failed" }

$commit = (& git -C $sourceFull rev-parse HEAD 2>$null)
$manifest = [ordered]@{
    ReleaseId = $ReleaseId
    Commit = "$commit"
    BuiltAt = (Get-Date).ToString("o")
    Node = $nodeVersion
    Python = (& $releasePython --version 2>&1 | Select-Object -First 1)
    FrontendIndexSha256 = (
        Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $releaseRoot "frontend\dist\index.html")
    ).Hash
    RequirementsSha256 = (
        Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $backendRoot "requirements.lock")
    ).Hash
    WhtPdfTemplateSha256 = (
        Get-FileHash -Algorithm SHA256 -LiteralPath (
            Join-Path $backendRoot "app\assets\templates\WHT-Template.pdf"
        )
    ).Hash
    TaxInvPdfTemplateSha256 = (
        Get-FileHash -Algorithm SHA256 -LiteralPath (
            Join-Path $backendRoot "app\assets\templates\TAX-INV-Template.pdf"
        )
    ).Hash
    SarabunFontSha256 = (
        Get-FileHash -Algorithm SHA256 -LiteralPath (
            Join-Path $backendRoot "app\assets\fonts\Sarabun-Regular.ttf"
        )
    ).Hash
}
$manifest |
    ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $releaseRoot "release-manifest.json") -Encoding UTF8

Write-Output "Release built and validated without activation: $releaseRoot"
