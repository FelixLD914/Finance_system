[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,

    [Parameter(Mandatory = $true)]
    [string]$DataRoot,

    [Parameter(Mandatory = $true)]
    [string]$BackupRoot,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1024, 65535)]
    [int]$HttpsPort,

    # 后端监听端口，默认 8100（BOI 占用 8000，ZWT 一律 "BOI + 100"）。
    # 必须与 winsw/zwt-finance-api.xml 的 ZWT_API_PORT 一致。
    [ValidateRange(1024, 65535)]
    [int]$ApiPort = 8100,

    [string]$NodeExe = "node.exe",
    [string]$PythonExe = "python.exe",
    [string]$PsqlExe = "psql.exe",
    [string]$CaddyExe = "caddy.exe"
)

$ErrorActionPreference = "Stop"

function Get-CommandVersion {
    param([string]$Command, [string[]]$Arguments)
    try {
        $resolved = Get-Command $Command -ErrorAction Stop
        $versionOutput = & $resolved.Source @Arguments 2>&1 | Select-Object -First 1
        return @{
            Found = $true
            Path = $resolved.Source
            Version = "$versionOutput"
        }
    }
    catch {
        return @{
            Found = $false
            Path = $null
            Version = $null
        }
    }
}

$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(80, 443, $HttpsPort, $ApiPort) } |
    Select-Object LocalAddress, LocalPort, OwningProcess

$volumeChecks = foreach ($path in @($InstallRoot, $DataRoot, $BackupRoot)) {
    $qualifier = Split-Path -Path $path -Qualifier
    $driveLetter = $qualifier.TrimEnd(":")
    $partition = Get-Partition -DriveLetter $driveLetter -ErrorAction SilentlyContinue
    $disk = if ($partition) {
        Get-Disk -Number $partition.DiskNumber -ErrorAction SilentlyContinue
    }
    $volume = Get-Volume -DriveLetter $driveLetter -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Path = $path
        Exists = Test-Path -LiteralPath $path
        Drive = $qualifier
        DiskNumber = $disk.Number
        DiskFriendlyName = $disk.FriendlyName
        DiskSerialNumber = $disk.SerialNumber
        SizeGiB = if ($volume) { [math]::Round($volume.Size / 1GB, 2) } else { $null }
        FreeGiB = if ($volume) { [math]::Round($volume.SizeRemaining / 1GB, 2) } else { $null }
    }
}

$node = Get-CommandVersion -Command $NodeExe -Arguments @("--version")
$python = Get-CommandVersion -Command $PythonExe -Arguments @("--version")
$psql = Get-CommandVersion -Command $PsqlExe -Arguments @("--version")
$caddy = Get-CommandVersion -Command $CaddyExe -Arguments @("version")

$nodeVersionValid = $false
if ($node.Found -and $node.Version -match "v?(\d+)\.(\d+)\.") {
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    $nodeVersionValid = ($major -gt 22) -or ($major -eq 22 -and $minor -ge 12)
}

$result = [ordered]@{
    ReadOnlyPreflight = $true
    Timestamp = (Get-Date).ToString("o")
    Computer = $computer.Name
    OsCaption = $os.Caption
    OsVersion = $os.Version
    OsBuild = $os.BuildNumber
    TargetBuildMatch = ($os.BuildNumber -eq "14393")
    PowerShellVersion = "$($PSVersionTable.PSVersion)"
    PathsAndPhysicalDisks = $volumeChecks
    BackupIsDifferentPhysicalDisk = (
        $volumeChecks.Count -eq 3 -and
        $volumeChecks[1].DiskNumber -ne $null -and
        $volumeChecks[2].DiskNumber -ne $null -and
        $volumeChecks[1].DiskNumber -ne $volumeChecks[2].DiskNumber
    )
    Ports = $listeners
    RequestedHttpsPortAvailable = -not ($listeners.LocalPort -contains $HttpsPort)
    IisBindingsUntouched = $true
    Node = $node
    NodeMeetsVite8Minimum = $nodeVersionValid
    Python = $python
    PostgreSqlClient = $psql
    Caddy = $caddy
}

$result | ConvertTo-Json -Depth 6

