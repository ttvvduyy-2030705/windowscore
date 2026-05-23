$ErrorActionPreference = "Stop"
$root = (Get-Location).Path
$target = Join-Path $root "src\scenes\game\game-play\GamePlayViewModel.tsx"
$source = Join-Path $root "GamePlayViewModel.tsx"
if (!(Test-Path $target)) { throw "Target not found: $target" }
if (!(Test-Path $source)) { throw "Source not found: $source" }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$target.bak-selected-match-1s-$stamp"
Copy-Item $target $backup -Force
Copy-Item $source $target -Force
Write-Host "Backup created: $backup"
Write-Host "Replaced GamePlayViewModel.tsx with selected-match 1s sync final file."
Write-Host "Now run these checks:"
Write-Host "Get-ChildItem .\src -Recurse -Include *.ts,*.tsx | Select-String 'AplusWebLiveCountdownSync|SELECTED_MATCH_REALTIME_1S_SYNC_FINAL'"
Write-Host "Then close the app and run: npm run windows"
