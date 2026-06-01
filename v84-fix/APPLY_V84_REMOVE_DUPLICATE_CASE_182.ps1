$ErrorActionPreference = "Stop"
$root = Get-Location
$cpp = Join-Path $root "windows\billiardsgrade\WindowsRemoteControlModule.cpp"

if (-not (Test-Path $cpp)) {
  throw "Cannot find $cpp. Run this script from C:\project\windowscore"
}

$backup = "$cpp.bak-v84-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $cpp $backup -Force
Write-Host "Backup:" $backup

$lines = Get-Content $cpp
$out = New-Object System.Collections.Generic.List[string]
$seen182 = $false
$removed = 0

foreach ($line in $lines) {
  if ($line -match '^\s*case\s+182\s*:') {
    if ($seen182) {
      Write-Host "Removed duplicate case 182:" $line.Trim()
      $removed++
      continue
    }
    $seen182 = $true
  }
  $out.Add($line)
}

if ($removed -eq 0) {
  Write-Host "No duplicate case 182 was removed. Checking current count..."
} else {
  Set-Content -Path $cpp -Value $out -Encoding UTF8
  Write-Host "Patched:" $cpp
}

$count182 = (Select-String -Path $cpp -Pattern '^\s*case\s+182\s*:' -AllMatches).Count
Write-Host "case 182 count now:" $count182

if ($count182 -gt 1) {
  throw "case 182 is still duplicated. Open windows\billiardsgrade\WindowsRemoteControlModule.cpp around line 240 and remove the extra case 182 manually."
}

Write-Host "Done. Now run:"
Write-Host "cd C:\project\windowscore"
Write-Host "taskkill /IM billiardsgrade.exe /F 2>`$null"
Write-Host "taskkill /IM ffmpeg.exe /F 2>`$null"
Write-Host "npx react-native run-windows"
