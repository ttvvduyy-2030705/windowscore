$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$gpvm = Join-Path $root 'src\scenes\game\game-play\GamePlayViewModel.tsx'
$patchedGpvm = Join-Path $PSScriptRoot 'GamePlayViewModel.tsx'
$consoleIndex = Join-Path $root 'src\scenes\game\game-play\console\index.tsx'
$hiddenSync = Join-Path $root 'src\scenes\game\game-play\console\AplusWebLiveCountdownSync.tsx'

if (!(Test-Path $gpvm)) { throw "Missing file: $gpvm" }
if (!(Test-Path $patchedGpvm)) { throw "Missing patched file: $patchedGpvm" }
if (!(Test-Path $consoleIndex)) { throw "Missing file: $consoleIndex" }

Copy-Item $gpvm "$gpvm.bak-clean-aplus-$stamp" -Force
Copy-Item $patchedGpvm $gpvm -Force
Write-Host "Patched GamePlayViewModel.tsx and created backup."

Copy-Item $consoleIndex "$consoleIndex.bak-clean-aplus-$stamp" -Force
$text = Get-Content $consoleIndex -Raw

# Remove import line for the hidden sync component.
$text = [regex]::Replace(
  $text,
  '(?m)^\s*import\s+AplusWebLiveCountdownSync\s+from\s+[''\"][^''\"]+[''\"];\s*\r?\n',
  ''
)

# Remove every self-closing JSX block: <AplusWebLiveCountdownSync ... />
$text = [regex]::Replace(
  $text,
  '\s*<AplusWebLiveCountdownSync\b[\s\S]*?/>\s*',
  "`r`n"
)

Set-Content -Path $consoleIndex -Value $text -Encoding UTF8
Write-Host "Removed hidden AplusWebLiveCountdownSync from console/index.tsx."

if (Test-Path $hiddenSync) {
  Rename-Item $hiddenSync "$hiddenSync.disabled-$stamp" -Force
  Write-Host "Disabled hidden sync file."
}

Write-Host "Done. Close the Windows app completely, then run: npm run windows"
Write-Host "After app opens: use the normal Aplus panel -> Tai lai -> choose tournament -> enter match code -> Kiem tra."
