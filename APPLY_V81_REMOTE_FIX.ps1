param(
  [string]$ProjectRoot = "C:\project\windowscore"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $ProjectRoot)) {
  throw "ProjectRoot not found: $ProjectRoot"
}

$PatchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$files = @(
  "src\utils\remote.windows.tsx",
  "src\scenes\game\game-play\GamePlayViewModel.tsx",
  "windows\billiardsgrade\WindowsRemoteControlModule.cpp"
)

foreach ($rel in $files) {
  $src = Join-Path $PatchRoot $rel
  $dst = Join-Path $ProjectRoot $rel
  if (!(Test-Path $src)) { throw "Patch file missing: $src" }
  if (!(Test-Path (Split-Path $dst -Parent))) { New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null }
  Copy-Item -Force $src $dst
  Write-Host "Patched $rel"
}

Write-Host "Done. Now run:"
Write-Host "cd $ProjectRoot"
Write-Host "taskkill /IM billiardsgrade.exe /F 2>`$null"
Write-Host "npx react-native run-windows"
