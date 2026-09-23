param([string]$DatabasePath=$env:SANTA_OPS_DB_PATH,[string]$BackupDirectory=$env:SANTA_OPS_BACKUP_DIR,[int]$RetentionDays=30,[switch]$VerifyOnly)
$ErrorActionPreference="Stop"
if([string]::IsNullOrWhiteSpace($DatabasePath)){throw "SANTA_OPS_DB_PATH or -DatabasePath is required"}
if([string]::IsNullOrWhiteSpace($BackupDirectory)){$BackupDirectory=Join-Path (Split-Path -Parent $DatabasePath) "backups"}
$database=[IO.Path]::GetFullPath($DatabasePath);$backupRoot=[IO.Path]::GetFullPath($BackupDirectory)
if(-not(Test-Path -LiteralPath $database -PathType Leaf)){throw "Database not found: $database"}
New-Item -ItemType Directory -Path $backupRoot -Force|Out-Null
function Test-Backup([string]$Path){$manifest="$Path.sha256";if(-not(Test-Path -LiteralPath $Path)-or-not(Test-Path -LiteralPath $manifest)){return $false};$expected=(Get-Content -LiteralPath $manifest -Raw).Trim().Split(' ')[0];return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $expected}
if($VerifyOnly){$all=@(Get-ChildItem -LiteralPath $backupRoot -Filter "santa-ops-*.sqlite" -File);$invalid=@($all|Where-Object{-not(Test-Backup $_.FullName)});if($invalid.Count){throw "Backup verification failed: $($invalid.Name -join ', ')"};Write-Output "Verified backups: $($all.Count)";exit 0}
$sqlite=Get-Command sqlite3 -ErrorAction SilentlyContinue;if(-not $sqlite){throw "sqlite3 is required for a consistent online backup"}
$stamp=Get-Date -Format "yyyyMMdd-HHmmss";$temporary=Join-Path $backupRoot ".santa-ops-$stamp.sqlite.tmp";$destination=Join-Path $backupRoot "santa-ops-$stamp.sqlite"
& $sqlite.Source $database ".timeout 10000" ".backup '$($temporary.Replace("'","''"))'";if($LASTEXITCODE-ne 0-or-not(Test-Path -LiteralPath $temporary)){throw "SQLite backup failed"}
Move-Item -LiteralPath $temporary -Destination $destination;$hash=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash;Set-Content -LiteralPath "$destination.sha256" -Value "$hash  $([IO.Path]::GetFileName($destination))" -Encoding ascii
if(-not(Test-Backup $destination)){throw "New backup verification failed"}
$cutoff=(Get-Date).AddDays(-$RetentionDays);Get-ChildItem -LiteralPath $backupRoot -Filter "santa-ops-*.sqlite" -File|Where-Object{$_.LastWriteTime-lt $cutoff-and(Test-Backup $_.FullName)}|ForEach-Object{Remove-Item -LiteralPath "$($_.FullName).sha256" -Force;Remove-Item -LiteralPath $_.FullName -Force}
Write-Output $destination
