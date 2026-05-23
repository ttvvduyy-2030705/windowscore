# Fix console/index.tsx encoding and remove hidden AplusWebLiveCountdownSync mount.
# ASCII-only script to avoid PowerShell parser/encoding problems.

$ErrorActionPreference = 'Stop'

$Root = Get-Location
$ConsoleDir = Join-Path $Root 'src\scenes\game\game-play\console'
$IndexPath = Join-Path $ConsoleDir 'index.tsx'

if (!(Test-Path $IndexPath)) {
  throw "Not found: $IndexPath"
}

function Read-TextFile([string]$Path) {
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
    return [System.Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2)
  }
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    return $utf8.GetString($bytes, 3, $bytes.Length - 3)
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  return $utf8NoBom.GetString($bytes)
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function Get-BadScore([string]$Text) {
  # Count characters common in Vietnamese mojibake: Ã Â Æ Ä Å º » ¢ € ™ �
  $badChars = @(
    [char]0x00C3,
    [char]0x00C2,
    [char]0x00C6,
    [char]0x00C4,
    [char]0x00C5,
    [char]0x00BA,
    [char]0x00BB,
    [char]0x00A2,
    [char]0x20AC,
    [char]0x2122,
    [char]0xFFFD
  )
  $score = 0
  foreach ($c in $badChars) {
    $score += ([regex]::Matches($Text, [regex]::Escape([string]$c))).Count
  }
  return $score
}

function Remove-HiddenSync([string]$Text) {
  # Remove the import line.
  $Text = [regex]::Replace(
    $Text,
    '(?m)^\s*import\s+AplusWebLiveCountdownSync\s+from\s+[''\"].*?AplusWebLiveCountdownSync[''\"];\s*\r?\n?',
    ''
  )

  # Remove every self-closing JSX mount block.
  $Text = [regex]::Replace(
    $Text,
    '(?ms)^\s*<AplusWebLiveCountdownSync\b[\s\S]*?/>\s*\r?\n?',
    ''
  )

  return $Text
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupBefore = "$IndexPath.bak-before-v3-$timestamp"
Copy-Item $IndexPath $BackupBefore -Force
Write-Host "Backup current index: $BackupBefore"

# Pick the cleanest index backup if current file is mojibake.
$candidates = @()
$candidates += Get-Item $IndexPath
$candidates += Get-ChildItem $ConsoleDir -File | Where-Object { $_.Name -like 'index.tsx.bak*' }

$best = $null
foreach ($file in $candidates) {
  try {
    $txt = Read-TextFile $file.FullName
    $score = Get-BadScore $txt
    $hasHiddenSync = $txt.Contains('AplusWebLiveCountdownSync')
    $obj = [pscustomobject]@{
      Path = $file.FullName
      Name = $file.Name
      Score = $score
      HasHiddenSync = $hasHiddenSync
      LastWriteTime = $file.LastWriteTime
      Text = $txt
    }
    if ($null -eq $best) {
      $best = $obj
    } elseif ($obj.Score -lt $best.Score) {
      $best = $obj
    } elseif ($obj.Score -eq $best.Score -and $obj.LastWriteTime -gt $best.LastWriteTime) {
      $best = $obj
    }
  } catch {
    Write-Host "Skip unreadable candidate: $($file.FullName)"
  }
}

if ($null -eq $best) {
  throw 'No readable index.tsx candidate found.'
}

Write-Host "Selected index source: $($best.Name) ; badScore=$($best.Score) ; hasHiddenSync=$($best.HasHiddenSync)"

$fixed = Remove-HiddenSync $best.Text
$AfterScore = Get-BadScore $fixed
Write-Utf8NoBom $IndexPath $fixed
Write-Host "Wrote cleaned UTF-8 index.tsx ; badScoreAfter=$AfterScore"

# Disable the hidden sync source file so accidental imports fail loudly instead of running hidden sync.
$SyncPath = Join-Path $ConsoleDir 'AplusWebLiveCountdownSync.tsx'
if (Test-Path $SyncPath) {
  $DisabledPath = "$SyncPath.disabled-v3-$timestamp"
  Move-Item $SyncPath $DisabledPath -Force
  Write-Host "Disabled hidden sync file: $DisabledPath"
}

# Verify current index.
$current = Read-TextFile $IndexPath
$importStillThere = $current.Contains('AplusWebLiveCountdownSync')
$finalScore = Get-BadScore $current
Write-Host "Verify: indexContainsHiddenSync=$importStillThere ; finalBadScore=$finalScore"

if ($importStillThere) {
  Write-Host 'WARNING: index.tsx still contains AplusWebLiveCountdownSync. Send this output back.'
}
if ($finalScore -gt 0) {
  Write-Host 'WARNING: index.tsx may still contain mojibake. Send this output back.'
}

Write-Host 'Done. Close the Windows app completely, then run: npm run windows'
