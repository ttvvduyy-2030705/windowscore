$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$consoleDir = Join-Path $root 'src\scenes\game\game-play\console'
$index = Join-Path $consoleDir 'index.tsx'
$hiddenSync = Join-Path $consoleDir 'AplusWebLiveCountdownSync.tsx'
$gpvm = Join-Path $root 'src\scenes\game\game-play\GamePlayViewModel.tsx'

if (!(Test-Path $index)) { throw "Missing file: $index" }

Copy-Item $index "$index.bak-fix-encoding-sync-$stamp" -Force
Write-Host "Backup index created: $index.bak-fix-encoding-sync-$stamp"

$utf8NoThrow = New-Object System.Text.UTF8Encoding($false, $false)
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$cp1252 = [System.Text.Encoding]::GetEncoding(1252)

function Count-BadText([string]$s) {
  if ($null -eq $s) { return 999999 }
  $matches = [regex]::Matches($s, 'Ã|Â|Ä|Æ|á»|áº|â|€|™|œ|�')
  return $matches.Count
}

function Count-GoodText([string]$s) {
  if ($null -eq $s) { return 0 }
  $tokens = @('Số lượt','Mục tiêu','Giải lao','Đổi cam','Bấm giờ','Ván mới','Tạm dừng','Kết thúc','Làm mới')
  $n = 0
  foreach ($t in $tokens) {
    if ($s.Contains($t)) { $n++ }
  }
  return $n
}

function Try-Repair-Mojibake([string]$s) {
  try {
    $bytes = $cp1252.GetBytes($s)
    return [System.Text.Encoding]::UTF8.GetString($bytes)
  } catch {
    return $s
  }
}

$text = [System.IO.File]::ReadAllText($index, $utf8NoThrow)
$originalBad = Count-BadText $text
$originalGood = Count-GoodText $text

# Repair mojibake produced by reading UTF-8 as ANSI/Windows-1252 and writing back as UTF-8.
for ($i = 0; $i -lt 3; $i++) {
  $candidate = Try-Repair-Mojibake $text
  $bad = Count-BadText $candidate
  $good = Count-GoodText $candidate
  if (($bad -lt (Count-BadText $text)) -or ($good -gt (Count-GoodText $text))) {
    $text = $candidate
  } else {
    break
  }
}

$afterBad = Count-BadText $text
$afterGood = Count-GoodText $text
Write-Host "Encoding check: bad $originalBad -> $afterBad ; good $originalGood -> $afterGood"

# Remove hidden sync import. This component used a fixed/config matchCode and can overwrite the selected match.
$text = [regex]::Replace(
  $text,
  '(?m)^\s*import\s+AplusWebLiveCountdownSync\s+from\s+[''\"][^''\"]+[''\"];\s*\r?\n',
  ''
)

# Remove every JSX block: <AplusWebLiveCountdownSync ... />
$text = [regex]::Replace(
  $text,
  '(?s)\r?\n\s*<AplusWebLiveCountdownSync\b[^>]*(?:\r?\n[^>]*)*?/>' ,
  "`r`n"
)

# Extra cleanup if a dangling blank area remains.
$text = [regex]::Replace($text, "(`r?`n){3,}", "`r`n`r`n")

[System.IO.File]::WriteAllText($index, $text, $utf8Bom)
Write-Host "Fixed console/index.tsx: UTF-8 text restored and hidden AplusWebLiveCountdownSync removed."

if (Test-Path $hiddenSync) {
  Rename-Item $hiddenSync "$hiddenSync.disabled-fix-encoding-sync-$stamp" -Force
  Write-Host "Disabled hidden sync file: $hiddenSync.disabled-fix-encoding-sync-$stamp"
}

if (Test-Path $gpvm) {
  $gpText = [System.IO.File]::ReadAllText($gpvm, $utf8NoThrow)
  if ($gpText.Contains('buildAplusLiveRealtimePayload') -and $gpText.Contains('realtime meta sync')) {
    Write-Host "GamePlayViewModel 1-second selected-match sync: FOUND"
  } else {
    Write-Host "WARNING: GamePlayViewModel selected-match 1-second sync not found. Send this output back if score still does not update."
  }
}

Write-Host "Done. Now close the Windows app completely, then run: npm run windows"
