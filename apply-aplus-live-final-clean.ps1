# apply-aplus-live-final-clean.ps1
# ASCII-only script. It applies the final Aplus live fix:
# - replace GamePlayViewModel with selected-match 1s sync
# - remove hidden AplusWebLiveCountdownSync from console/index.tsx
# - disable the hidden sync component file so it cannot claim a wrong match

$ErrorActionPreference = 'Stop'
$root = Get-Location
$gpTarget = Join-Path $root 'src\scenes\game\game-play\GamePlayViewModel.tsx'
$gpSource = Join-Path $root 'GamePlayViewModel.SELECTED_MATCH_1S_FIXED.tsx'
$indexTarget = Join-Path $root 'src\scenes\game\game-play\console\index.tsx'
$hiddenSync = Join-Path $root 'src\scenes\game\game-play\console\AplusWebLiveCountdownSync.tsx'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (!(Test-Path $gpTarget)) { throw "Missing target: $gpTarget" }
if (!(Test-Path $gpSource)) { throw "Missing source: $gpSource" }
if (!(Test-Path $indexTarget)) { throw "Missing index: $indexTarget" }

Copy-Item $gpTarget "$gpTarget.bak-aplus-live-final-$stamp" -Force
Copy-Item $gpSource $gpTarget -Force
Write-Host "Updated GamePlayViewModel.tsx"

$idx = Get-Content $indexTarget -Raw -Encoding UTF8
$orig = $idx
$idx = [regex]::Replace($idx, "(?m)^\s*import\s+AplusWebLiveCountdownSync\s+from\s+'\.\/AplusWebLiveCountdownSync';\s*\r?\n", "")
$idx = [regex]::Replace($idx, "(?m)^\s*import\s+AplusWebLiveCountdownSync\s+from\s+\"\.\/AplusWebLiveCountdownSync\";\s*\r?\n", "")
$idx = [regex]::Replace($idx, "\r?\n\s*<AplusWebLiveCountdownSync\b[\s\S]*?\/>", "")

if ($idx -ne $orig) {
  Copy-Item $indexTarget "$indexTarget.bak-aplus-live-final-$stamp" -Force
  Set-Content $indexTarget $idx -Encoding UTF8
  Write-Host "Removed hidden AplusWebLiveCountdownSync from console/index.tsx"
} else {
  Write-Host "No hidden AplusWebLiveCountdownSync block found in console/index.tsx"
}

if (Test-Path $hiddenSync) {
  Rename-Item $hiddenSync ($hiddenSync + ".disabled-final-" + $stamp) -Force
  Write-Host "Disabled hidden sync component file"
}

Write-Host "Done. Close the Windows app completely, then run: npm run windows"
Write-Host "Expected check: SELECTED_MATCH_REALTIME_1S_SYNC_FINAL exists; AplusWebLiveCountdownSync is absent from console/index.tsx"
