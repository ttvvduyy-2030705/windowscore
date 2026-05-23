$ErrorActionPreference = 'Stop'

$root = Get-Location
$indexPath = Join-Path $root 'src\scenes\game\game-play\console\index.tsx'
$syncPath = Join-Path $root 'src\scenes\game\game-play\console\AplusWebLiveCountdownSync.tsx'

if (!(Test-Path $indexPath)) {
  throw "Cannot find file: $indexPath"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = "$indexPath.bak-remove-duplicate-aplus-sync-$stamp"
Copy-Item $indexPath $backupPath -Force
Write-Host "Backup created: $backupPath"

$lines = [System.Collections.Generic.List[string]]::new()
[System.IO.File]::ReadAllLines($indexPath) | ForEach-Object { [void]$lines.Add($_) }

$out = [System.Collections.Generic.List[string]]::new()
$skippingComponent = $false
$removedImports = 0
$removedBlocks = 0

for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]

  # Remove import line for the hidden duplicate sync component.
  if ($line -match '^\s*import\s+AplusWebLiveCountdownSync\s+from\s+["'']\.\/AplusWebLiveCountdownSync["''];?\s*$') {
    $removedImports++
    continue
  }

  # Remove the JSX block <AplusWebLiveCountdownSync ... /> even if it spans many lines.
  if (-not $skippingComponent -and $line -match '<AplusWebLiveCountdownSync\b') {
    $skippingComponent = $true
    $removedBlocks++
    if ($line -match '\/>' ) {
      $skippingComponent = $false
    }
    continue
  }

  if ($skippingComponent) {
    if ($line -match '\/>' ) {
      $skippingComponent = $false
    }
    continue
  }

  [void]$out.Add($line)
}

[System.IO.File]::WriteAllLines($indexPath, $out, [System.Text.UTF8Encoding]::new($false))
Write-Host "Removed import lines: $removedImports"
Write-Host "Removed AplusWebLiveCountdownSync blocks: $removedBlocks"

if (Test-Path $syncPath) {
  $disabledPath = "$syncPath.disabled-$stamp"
  Rename-Item $syncPath $disabledPath -Force
  Write-Host "Disabled duplicate sync file: $disabledPath"
} else {
  Write-Host "Duplicate sync file not found, skipped rename."
}

# Verify leftover references.
$leftovers = Select-String -Path $indexPath -Pattern 'AplusWebLiveCountdownSync' -SimpleMatch -ErrorAction SilentlyContinue
if ($leftovers) {
  Write-Host "WARNING: index.tsx still contains AplusWebLiveCountdownSync references:"
  $leftovers | ForEach-Object { Write-Host ($_.LineNumber.ToString() + ': ' + $_.Line) }
  Write-Host "Manual cleanup may still be needed."
} else {
  Write-Host "OK: index.tsx has no AplusWebLiveCountdownSync references."
}

Write-Host "Done. Close the Windows app completely, then run: npm run windows"
