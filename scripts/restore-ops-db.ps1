param([Parameter(Mandatory=$true)][string]$BackupPath,[string]$DatabasePath=$env:SANTA_OPS_DB_PATH,[string]$ServicePidFile=$env:SANTA_OPS_PID_FILE,[switch]$ServiceStopped)
$ErrorActionPreference="Stop";if([string]::IsNullOrWhiteSpace($DatabasePath)){throw "SANTA_OPS_DB_PATH or -DatabasePath is required"}
$backup=[IO.Path]::GetFullPath($BackupPath);$database=[IO.Path]::GetFullPath($DatabasePath);if(-not(Test-Path -LiteralPath $backup -PathType Leaf)){throw "Backup not found: $backup"};if(-not(Test-Path -LiteralPath "$backup.sha256")){throw "Backup manifest not found"}
$expected=(Get-Content -LiteralPath "$backup.sha256" -Raw).Trim().Split(' ')[0];if((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash-ne $expected){throw "Backup checksum mismatch"}
$shutdownVerified=$ServiceStopped
if($ServicePidFile-and(Test-Path -LiteralPath $ServicePidFile)){$servicePid=[int](Get-Content -LiteralPath $ServicePidFile -Raw).Trim();if(Get-Process -Id $servicePid -ErrorAction SilentlyContinue){throw "Stop the Santa Ops service before restore"};$shutdownVerified=$true}
if(-not $shutdownVerified){throw "Restore requires -ServiceStopped or a PID file proving the service is stopped"}
$preRestore=& "$PSScriptRoot\backup-ops-db.ps1" -DatabasePath $database;if(-not $preRestore){throw "Pre-restore backup failed"}
$restoreTemp="$database.restore.tmp";Copy-Item -LiteralPath $backup -Destination $restoreTemp -Force;Move-Item -LiteralPath $restoreTemp -Destination $database -Force;Write-Output "Restored $database; pre-restore backup: $preRestore"
