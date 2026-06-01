$ErrorActionPreference = "Stop"
$root = (Get-Location).Path

function Patch-TextFile {
  param(
    [string]$Path,
    [scriptblock]$Transform
  )
  if (!(Test-Path $Path)) { throw "Missing file: $Path" }
  $text = Get-Content -Raw -Path $Path
  $newText = & $Transform $text
  if ($newText -ne $text) {
    Set-Content -Path $Path -Value $newText -Encoding UTF8
    Write-Host "Patched $Path"
  } else {
    Write-Host "No change needed $Path"
  }
}

$native = Join-Path $root "windows\billiardsgrade\WindowsRemoteControlModule.cpp"
Patch-TextFile $native {
  param($text)

  # Map F13/F14 sent by the outside Volume Guard helper.
  # F13 = physical Bấm giờ / VolumeDown. F14 = physical Thêm giờ / VolumeUp.
  if ($text -notmatch 'Aplus Remote Guard F13') {
    $replacement = @'
case 39:
            return "RIGHT";
        case 124: // Aplus Remote Guard F13: physical Bam gio / VolumeDown, swallowed outside app
            return "TIMER";
        case 125: // Aplus Remote Guard F14: physical Them gio / VolumeUp, swallowed outside app
            return "EXTENSION";
'@
    $text = [regex]::Replace($text, 'case 39:\s*\r?\n\s*return "RIGHT";', $replacement, 1)
  }

  return $text
}

$remoteJs = Join-Path $root "src\utils\remote.windows.tsx"
if (Test-Path $remoteJs) {
  Patch-TextFile $remoteJs {
    param($text)

    if ($text -notmatch "F13:\s*'TIMER'") {
      $text = $text -replace "TIMER:\s*'TIMER',", "TIMER: 'TIMER',`r`n      F13: 'TIMER',`r`n      F13_TIMER: 'TIMER',`r`n      KEY_F13: 'TIMER',"
    }

    if ($text -notmatch "F14:\s*'EXTENSION'") {
      $text = $text -replace "EXTENSION:\s*'EXTENSION',", "EXTENSION: 'EXTENSION',`r`n      F14: 'EXTENSION',`r`n      F14_EXTENSION: 'EXTENSION',`r`n      KEY_F14: 'EXTENSION',"
    }

    return $text
  }
}

Copy-Item -Force (Join-Path $PSScriptRoot "START_APLUS_REMOTE_VOLUME_GUARD.ps1") (Join-Path $root "START_APLUS_REMOTE_VOLUME_GUARD.ps1")
Copy-Item -Force (Join-Path $PSScriptRoot "RUN_APP_WITH_REMOTE_GUARD.ps1") (Join-Path $root "RUN_APP_WITH_REMOTE_GUARD.ps1")

Write-Host ""
Write-Host "Done v82b. This fix needs the guard helper because Windows handles VolumeUp/Down before the React Native app can fully block the OSD."
Write-Host "Run app with:"
Write-Host "powershell -ExecutionPolicy Bypass -File .\RUN_APP_WITH_REMOTE_GUARD.ps1"
