[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PsqlExe,

    [Parameter(Mandatory = $true)]
    [string]$CreatedbExe,

    [Parameter(Mandatory = $true)]
    [string]$DropdbExe,

    [Parameter(Mandatory = $true)]
    [string]$PgRestoreExe,

    [Parameter(Mandatory = $true)]
    [string]$AdminDatabaseUrl,

    [Parameter(Mandatory = $true)]
    [string]$BackupFile
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
    throw "Backup file not found: $BackupFile"
}

$verificationDatabase = "zwt_restore_verify_" + (Get-Date -Format "yyyyMMddHHmmss")
$verificationUrlBuilder = [System.UriBuilder]$AdminDatabaseUrl
$verificationUrlBuilder.Path = $verificationDatabase
$verificationUrl = $verificationUrlBuilder.Uri.AbsoluteUri
try {
    & $CreatedbExe --maintenance-db=$AdminDatabaseUrl $verificationDatabase
    if ($LASTEXITCODE -ne 0) { throw "createdb failed" }

    & $PgRestoreExe --dbname=$verificationUrl `
        --clean --if-exists --no-owner $BackupFile
    if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }

    $tableCount = & $PsqlExe $verificationUrl `
        --tuples-only --no-align `
        --command="SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('core','wht','tax_invoice','audit');"
    if ($LASTEXITCODE -ne 0 -or [int]$tableCount -lt 4) {
        throw "restored schema verification failed"
    }

    Write-Output "Restore verification passed for $BackupFile with $tableCount application tables."
}
finally {
    & $DropdbExe --maintenance-db=$AdminDatabaseUrl --if-exists $verificationDatabase
}
