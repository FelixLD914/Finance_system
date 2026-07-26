[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PgDumpExe,

    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrl,

    [Parameter(Mandatory = $true)]
    [string]$AttachmentRoot,

    [Parameter(Mandatory = $true)]
    [string]$BackupRoot,

    [ValidateRange(1, 31)]
    [int]$RetentionDays = 7
)

$ErrorActionPreference = "Stop"
$backupRootFull = [System.IO.Path]::GetFullPath($BackupRoot)
$backupDriveRoot = [System.IO.Path]::GetPathRoot($backupRootFull)
if ($backupRootFull -eq $backupDriveRoot) {
    throw "BackupRoot cannot be a drive root."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dailyRoot = Join-Path $backupRootFull $stamp
$databaseFile = Join-Path $dailyRoot "zwt-finance.dump"
$attachmentTarget = Join-Path $dailyRoot "attachments"
New-Item -ItemType Directory -Path $dailyRoot -ErrorAction Stop | Out-Null

& $PgDumpExe --dbname=$DatabaseUrl --format=custom --file=$databaseFile
if ($LASTEXITCODE -ne 0) {
    throw "pg_dump failed with exit code $LASTEXITCODE"
}

New-Item -ItemType Directory -Path $attachmentTarget | Out-Null
& robocopy.exe $AttachmentRoot $attachmentTarget /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:3 /NFL /NDL
if ($LASTEXITCODE -ge 8) {
    throw "Attachment backup failed with robocopy exit code $LASTEXITCODE"
}

Get-FileHash -Algorithm SHA256 -LiteralPath $databaseFile |
    Select-Object Algorithm, Hash, Path |
    ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $dailyRoot "database.sha256.json") -Encoding UTF8

$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -LiteralPath $backupRootFull -Directory |
    Where-Object { $_.LastWriteTime -lt $cutoff -and $_.FullName.StartsWith($backupRootFull) } |
    Remove-Item -Recurse -Force

Write-Output "Backup completed: $dailyRoot"

