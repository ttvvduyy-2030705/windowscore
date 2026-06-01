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

  # v82/v82b used an outside PowerShell guard and inserted F13/F14 cases.
  # Remove them so the project builds normally and the app does not depend on the helper.
  $text = [regex]::Replace(
    $text,
    '\r?\n\s*case 124:\s*//[^\r\n]*Aplus Remote Guard F13[^\r\n]*\r?\n\s*return "TIMER";\s*\r?\n\s*case 125:\s*//[^\r\n]*Aplus Remote Guard F14[^\r\n]*\r?\n\s*return "EXTENSION";',
    '',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )

  # Remove any accidental duplicate media-key cases that may have been inserted by older patches.
  # Keep the original v80/v81 meanings only once.
  $text = [regex]::Replace($text, '(?s)case 181:\s*//[^\r\n]*next track\s*\r?\n\s*return "BREAK";\s*\r?\n\s*case 182:\s*//[^\r\n]*previous track\s*\r?\n\s*return "WARM_UP";\s*\r?\n\s*case 182:\s*//[^\r\n]*previous track\s*\r?\n\s*return "WARM_UP";', 'case 181: // next track`r`n            return "BREAK";`r`n        case 182: // previous track`r`n            return "WARM_UP";')

  # Enforce the real physical mapping found from your logs:
  # Bấm giờ sends VOLUME_DOWN => TIMER. Thêm giờ sends VOLUME_UP => EXTENSION.
  $text = $text -replace 'case 175:\s*//[^\r\n]*\r?\n\s*return "TIMER";', 'case 175: // Real Windows HID mapping: physical Them gio sends VolumeUp.`r`n            return "EXTENSION";'
  $text = $text -replace 'case 174:\s*//[^\r\n]*\r?\n\s*return "EXTENSION";', 'case 174: // Real Windows HID mapping: physical Bam gio sends VolumeDown.`r`n            return "TIMER";'

  return $text
}

$remoteJs = Join-Path $root "src\utils\remote.windows.tsx"
if (Test-Path $remoteJs) {
  Patch-TextFile $remoteJs {
    param($text)

    # Remove v82 helper F13/F14 JS aliases; app will use normal Windows volume key events only.
    $text = [regex]::Replace($text, '\r?\n\s*F13:\s*''TIMER'',\s*\r?\n\s*F13_TIMER:\s*''TIMER'',\s*\r?\n\s*KEY_F13:\s*''TIMER'',', '')
    $text = [regex]::Replace($text, '\r?\n\s*F14:\s*''EXTENSION'',\s*\r?\n\s*F14_EXTENSION:\s*''EXTENSION'',\s*\r?\n\s*KEY_F14:\s*''EXTENSION'',', '')

    # Enforce mapping in JS fallback too.
    $text = $text -replace "VOLUME_DOWN:\s*'EXTENSION'", "VOLUME_DOWN: 'TIMER'"
    $text = $text -replace "VOLUME_UP:\s*'TIMER'", "VOLUME_UP: 'EXTENSION'"

    return $text
  }
}

Write-Host ""
Write-Host "Done v83 in-app-only build/mapping fix."
Write-Host "Run normally with:"
Write-Host "taskkill /IM billiardsgrade.exe /F 2>`$null"
Write-Host "taskkill /IM ffmpeg.exe /F 2>`$null"
Write-Host "npx react-native run-windows"
Write-Host ""
Write-Host "Note: this removes the outside PowerShell volume guard. If Windows still shows the volume OSD, that is because the remote sends real system VolumeUp/Down keys before the UWP app can fully swallow the shell OSD."
