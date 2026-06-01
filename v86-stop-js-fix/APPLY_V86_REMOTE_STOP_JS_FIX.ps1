$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
Write-Host "Aplus remote v86 STOP JS fix - root: $root"

function ReadText($path) {
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}
function WriteText($path, $text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

# 1) Native Windows key map: VK_MEDIA_STOP = 178 must return STOP.
$cppPath = Join-Path $root 'windows\billiardsgrade\WindowsRemoteControlModule.cpp'
if (Test-Path $cppPath) {
  $cpp = ReadText $cppPath
  $before = $cpp

  # Normalize existing case 178 block to STOP. This avoids duplicate case insertion.
  $cpp = [regex]::Replace(
    $cpp,
    'case\s+178\s*:\s*(?://[^\r\n]*)?\r?\n\s*return\s+"[^"]+"\s*;',
    "case 178: // VK_MEDIA_STOP / physical Stop\r\n            return \"STOP\";",
    1
  )

  if ($cpp -eq $before -and $cpp -notmatch 'case\s+178\s*:') {
    # Insert before media play/pause if present, otherwise before default.
    $insert = "        case 178: // VK_MEDIA_STOP / physical Stop`r`n            return \"STOP\";`r`n"
    if ($cpp -match 'case\s+179\s*:') {
      $cpp = [regex]::Replace($cpp, '(\s*)case\s+179\s*:', "`$1$insert`$1case 179:", 1)
    } elseif ($cpp -match 'default\s*:') {
      $cpp = [regex]::Replace($cpp, '(\s*)default\s*:', "`$1$insert`$1default:", 1)
    }
  }

  if ($cpp -ne $before) {
    WriteText $cppPath $cpp
    Write-Host "Patched native STOP key map in $cppPath"
  } else {
    Write-Host "Native STOP key map already looks patched or case 178 pattern not found. Continuing."
  }
} else {
  Write-Host "WARN: $cppPath not found. Skipping native map."
}

# 2) JS gameplay action: add STOP branch near existing START branch.
$targetFiles = Get-ChildItem -Path (Join-Path $root 'src') -Recurse -Include *.tsx,*.ts -ErrorAction SilentlyContinue |
  Sort-Object @{Expression={ if ($_.FullName -match 'GamePlayViewModel\.tsx$') {0} elseif ($_.FullName -match 'game-play') {1} else {2} }}, FullName

$patchedJs = $false
foreach ($f in $targetFiles) {
  $text = ReadText $f.FullName
  if ($text -notmatch '\[Remote\]\[Start\] pressed') { continue }
  if ($text -match '\[Remote\]\[Stop\] pressed') {
    Write-Host "JS STOP branch already exists in $($f.FullName)"
    $patchedJs = $true
    break
  }

  $lines = $text -split "`r?`n", -1
  $startLogIndex = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '\[Remote\]\[Start\] pressed') { $startLogIndex = $i; break }
  }
  if ($startLogIndex -lt 0) { continue }

  # Try normal IF branch first.
  $ifIndex = -1
  for ($j = $startLogIndex; $j -ge [Math]::Max(0, $startLogIndex - 30); $j--) {
    if ($lines[$j] -match '^(\s*)if\s*\((.*START.*)\)\s*\{\s*$') { $ifIndex = $j; break }
  }

  if ($ifIndex -ge 0) {
    $indent = ([regex]::Match($lines[$ifIndex], '^\s*')).Value
    $ifTrim = $lines[$ifIndex].TrimStart()
    $stopIfTrim = $ifTrim -replace 'START', 'STOP'
    $block = @(
      $indent + $stopIfTrim,
      $indent + "  console.log('[Remote][Stop] pressed', {isStarted, isPaused});",
      $indent + "  // STOP chi dung/pause countdown, khong stop ghi hinh/live.",
      $indent + "  if (isStarted) {",
      $indent + "    setIsPaused(true);",
      $indent + "  }",
      $indent + "  return;",
      $indent + "}",
      ""
    )
    $newLines = @()
    if ($ifIndex -gt 0) { $newLines += $lines[0..($ifIndex-1)] }
    $newLines += $block
    $newLines += $lines[$ifIndex..($lines.Count-1)]
    WriteText $f.FullName ($newLines -join "`r`n")
    Write-Host "Patched JS STOP branch before START if in $($f.FullName)"
    $patchedJs = $true
    break
  }

  # Try switch/case branch.
  $caseIndex = -1
  for ($j = $startLogIndex; $j -ge [Math]::Max(0, $startLogIndex - 30); $j--) {
    if ($lines[$j] -match '^(\s*)case\s+[\"'']START[\"'']\s*:\s*$') { $caseIndex = $j; break }
  }

  if ($caseIndex -ge 0) {
    $indent = ([regex]::Match($lines[$caseIndex], '^\s*')).Value
    $block = @(
      $indent + "case 'STOP':",
      $indent + "  console.log('[Remote][Stop] pressed', {isStarted, isPaused});",
      $indent + "  // STOP chi dung/pause countdown, khong stop ghi hinh/live.",
      $indent + "  if (isStarted) {",
      $indent + "    setIsPaused(true);",
      $indent + "  }",
      $indent + "  return;",
      ""
    )
    $newLines = @()
    if ($caseIndex -gt 0) { $newLines += $lines[0..($caseIndex-1)] }
    $newLines += $block
    $newLines += $lines[$caseIndex..($lines.Count-1)]
    WriteText $f.FullName ($newLines -join "`r`n")
    Write-Host "Patched JS STOP branch before START case in $($f.FullName)"
    $patchedJs = $true
    break
  }

  # Last-resort diagnostic output: show context so user can paste it back.
  Write-Host "Found [Remote][Start] log but could not identify enclosing IF/CASE in $($f.FullName). Context:"
  $from = [Math]::Max(0, $startLogIndex - 12)
  $to = [Math]::Min($lines.Count - 1, $startLogIndex + 12)
  for ($k = $from; $k -le $to; $k++) { Write-Host (($k+1).ToString().PadLeft(5) + ': ' + $lines[$k]) }
}

if (-not $patchedJs) {
  throw "Khong chen duoc STOP branch trong JS. Hay gui lai doan Context o tren."
}

Write-Host "Done v86 STOP fix. Now run:"
Write-Host "cd C:\project\windowscore"
Write-Host "taskkill /IM billiardsgrade.exe /F 2>`$null"
Write-Host "npx react-native run-windows"
