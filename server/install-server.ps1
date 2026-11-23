param(
  [int]$Port = 3000,
  [string]$InstallDir = $PSScriptRoot,
  [string]$ApplicationExe = "",
  [string]$DataDir = "C:\BETAF",
  [string]$ShareName = "BETAF",
  [switch]$NoShare
)
$ErrorActionPreference = "Stop"
$taskName = "BETAF Studio Server"
$script = Join-Path $InstallDir "server.cjs"
$launcher = Join-Path $InstallDir "start-server.cmd"
if (-not (Test-Path -LiteralPath $DataDir)) {
  $isUncPath = $DataDir -match '^[\\]{2}[^\\]+\\[^\\]+'
  if ($isUncPath) {
    throw "Le partage réseau '$DataDir' est introuvable ou inaccessible. Créez d'abord le partage Windows et vérifiez vos droits d'accès."
  }
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}
$resolvedDataDir = (Resolve-Path -LiteralPath $DataDir).Path
if (-not $NoShare -and $DataDir -notmatch '^[\\]{2}') {
  if (-not (Get-Command New-SmbShare -ErrorAction SilentlyContinue)) {
    throw "La commande New-SmbShare est indisponible. Activez le partage de fichiers Windows ou utilisez -NoShare."
  }
  $existingShare = Get-SmbShare -Name $ShareName -ErrorAction SilentlyContinue
  if (-not $existingShare) {
    $everyoneSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
    $everyoneName = $everyoneSid.Translate([System.Security.Principal.NTAccount]).Value
    New-SmbShare -Name $ShareName -Path $resolvedDataDir -ChangeAccess $everyoneName -Description "Données partagées BETAF Studio" | Out-Null
  } elseif ($existingShare.Path -ne $resolvedDataDir) {
    throw "Le partage '$ShareName' existe déjà et pointe vers '$($existingShare.Path)'."
  }
}
New-NetFirewallRule -DisplayName "BETAF Studio Server $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private -ErrorAction SilentlyContinue | Out-Null
if ($ApplicationExe -and (Test-Path $ApplicationExe)) {
  $taskAction = New-ScheduledTaskAction -Execute $ApplicationExe -Argument "--betaf-server --betaf-data-dir `"$resolvedDataDir`""
  Start-Process -FilePath $ApplicationExe -ArgumentList @("--betaf-server", "--betaf-data-dir", $resolvedDataDir)
} else {
  $node = (Get-Command node -ErrorAction Stop).Source
  $taskAction = New-ScheduledTaskAction -Execute $launcher -Argument "`"$resolvedDataDir`""
  Start-Process -FilePath $launcher -ArgumentList @($resolvedDataDir) -WorkingDirectory $InstallDir
}
$taskTrigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
Write-Host "BETAF Studio Server configure sur le port $Port."
Write-Host "Dossier central BETAF : $resolvedDataDir"
if (-not $NoShare -and $DataDir -notmatch '^[\\]{2}') {
  Write-Host "Chemin de partage pour les autres postes : \\$env:COMPUTERNAME\$ShareName"
}
if ($resolvedDataDir -match '^[\\]{2}') {
  Write-Warning "Le compte SYSTEM du Planificateur de tâches peut ne pas avoir accès au partage réseau. Utilisez un compte Windows autorisé au partage ou un dossier local partagé sur ce poste."
}
Write-Host "Adresses reseau disponibles :"
Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*"} | Select-Object -ExpandProperty IPAddress
