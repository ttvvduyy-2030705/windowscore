$ErrorActionPreference = 'Stop'

$root = Get-Location
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$gpTarget = Join-Path $root 'src\scenes\game\game-play\GamePlayViewModel.tsx'
$gpSource = Join-Path $root 'GamePlayViewModel.SELECTED_MATCH_1S_FIXED.tsx'
$indexTarget = Join-Path $root 'src\scenes\game\game-play\console\index.tsx'
$hiddenSync = Join-Path $root 'src\scenes\game\game-play\console\AplusWebLiveCountdownSync.tsx'

if (!(Test-Path $gpTarget)) { throw ('Missing target: ' + $gpTarget) }
if (!(Test-Path $gpSource)) { throw ('Missing source: ' + $gpSource) }
if (!(Test-Path $indexTarget)) { throw ('Missing index: ' + $indexTarget) }

Copy-Item $gpTarget ($gpTarget + '.bak-selected-live-final-v2-' + $stamp) -Force
Copy-Item $gpSource $gpTarget -Force
Write-Host 'Updated GamePlayViewModel.tsx with selected-match 1s sync.'

$enc = New-Object System.Text.UTF8Encoding($false)
$idx = [System.IO.File]::ReadAllText($indexTarget, $enc)
Copy-Item $indexTarget ($indexTarget + '.bak-remove-hidden-sync-v2-' + $stamp) -Force

$lines = [System.Text.RegularExpressions.Regex]::Split($idx, '\r?\n')
$out = New-Object System.Collections.Generic.List[string]
$inBlock = $false
$removed = 0

foreach ($line in $lines) {
  if ($inBlock) {
    if ($line.Contains('/>')) { $inBlock = $false }
    $removed++
    continue
  }

  if ($line.Contains('AplusWebLiveCountdownSync') -and $line.Contains('import')) {
    $removed++
    continue
  }

  if ($line.Contains('<AplusWebLiveCountdownSync')) {
    if (-not $line.Contains('/>')) { $inBlock = $true }
    $removed++
    continue
  }

  $out.Add($line)
}

$newIdx = [string]::Join([Environment]::NewLine, $out)
[System.IO.File]::WriteAllText($indexTarget, $newIdx, $enc)
Write-Host ('Removed hidden sync lines/blocks from index.tsx: ' + $removed)

if (Test-Path $hiddenSync) {
  $disabledPath = $hiddenSync + '.disabled-selected-live-final-v2-' + $stamp
  Rename-Item $hiddenSync $disabledPath -Force
  Write-Host ('Disabled hidden sync file: ' + $disabledPath)
}

Write-Host 'Done.'
Write-Host 'Now close the Windows app completely, then run: npm run windows'
Write-Host 'Verify command:'
Write-Host 'Get-ChildItem .\src -Recurse -Include *.ts,*.tsx | Select-String "AplusWebLiveCountdownSync|SELECTED_MATCH_REALTIME_1S_SYNC_FINAL"'
