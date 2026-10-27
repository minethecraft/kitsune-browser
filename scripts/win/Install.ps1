# Kitsune per-user installer (no admin needed)
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'Kitsune'
$dst = Join-Path $env:LOCALAPPDATA 'Programs\Kitsune'
Write-Host 'Installing Kitsune to' $dst
Get-Process Kitsune -ErrorAction SilentlyContinue | Stop-Process -Force
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item "$src\*" $dst -Recurse -Force
$exe = Join-Path $dst 'Kitsune.exe'
$ws = New-Object -ComObject WScript.Shell
foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Kitsune.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Kitsune.lnk'))) {
  $s = $ws.CreateShortcut($lnk); $s.TargetPath = $exe; $s.WorkingDirectory = $dst; $s.IconLocation = "$exe,0"; $s.Save()
}
# Uninstaller script
@"
Get-Process Kitsune -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item '$dst' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Kitsune.lnk') -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'Kitsune.lnk') -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Kitsune' -ErrorAction SilentlyContinue
"@ | Set-Content (Join-Path $env:LOCALAPPDATA 'Programs\Kitsune-Uninstall.ps1')
# Add/Remove Programs entry
$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Kitsune'
New-Item $k -Force | Out-Null
Set-ItemProperty $k DisplayName 'Kitsune'
Set-ItemProperty $k DisplayIcon $exe
Set-ItemProperty $k InstallLocation $dst
Set-ItemProperty $k Publisher 'Kitsune'
Set-ItemProperty $k UninstallString ('powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $env:LOCALAPPDATA 'Programs\Kitsune-Uninstall.ps1') + '"')
Start-Process $exe
Write-Host 'Done! Kitsune is installed and launching.'
