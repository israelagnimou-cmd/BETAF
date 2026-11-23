param([string]$DataDir = (Join-Path $PSScriptRoot "data"))
$backupDir = Join-Path $DataDir "backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$source = Join-Path $DataDir "betaf.sqlite"
if (Test-Path $source) { Copy-Item $source (Join-Path $backupDir ("manual-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".sqlite")) }
Get-ChildItem $backupDir -Filter "*.sqlite" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force
