# Test FFmpeg DirectShow camera access outside the React Native app.
# Run in PowerShell from project root:
#   powershell -ExecutionPolicy Bypass -File tools\aplus-test-ffmpeg-camera.ps1

$ErrorActionPreference = 'Continue'

$candidates = @(
  "$env:LOCALAPPDATA\AplusScore\ffmpeg\ffmpeg.exe",
  "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe",
  "C:\ffmpeg\bin\ffmpeg.exe",
  "$PSScriptRoot\..\windows\x64\Debug\billiardsgrade\AppX\Assets\ffmpeg\ffmpeg.exe",
  "ffmpeg.exe"
)

$ffmpeg = $null
foreach ($p in $candidates) {
  try {
    if ($p -eq 'ffmpeg.exe') {
      $cmd = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
      if ($cmd) { $ffmpeg = $cmd.Source; break }
    } elseif (Test-Path $p) {
      $ffmpeg = (Resolve-Path $p).Path
      break
    }
  } catch {}
}

if (-not $ffmpeg) {
  Write-Host "[FAIL] Không tìm thấy ffmpeg.exe" -ForegroundColor Red
  exit 1
}

Write-Host "[INFO] FFmpeg: $ffmpeg" -ForegroundColor Cyan

$list = & $ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1 | Out-String
Write-Host "`n===== DirectShow device list ====="
Write-Host $list

$camera = $null
$lines = $list -split "`r?`n"
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match 'DirectShow video devices' -or $lines[$i] -match '"(.+?)" \(video\)' -or $lines[$i] -match '"(.+?)" \(none\)') {
    for ($j = $i + 1; $j -lt $lines.Count; $j++) {
      if ($lines[$j] -match 'DirectShow audio devices') { break }
      if ($lines[$j] -match '"(.+?)"') {
        $name = $Matches[1]
        if ($name -notmatch '^@device_') { $camera = $name; break }
      }
    }
    if ($camera) { break }
  }
}

if (-not $camera) {
  Write-Host "[FAIL] FFmpeg không parse được camera từ list_devices." -ForegroundColor Red
  exit 2
}

Write-Host "`n[INFO] Test mở camera: $camera" -ForegroundColor Cyan
$open = & $ffmpeg -hide_banner -y -t 5 -f dshow -i "video=$camera" -an -f null NUL 2>&1 | Out-String
Write-Host "`n===== Camera open test ====="
Write-Host $open

if ($open -match 'Unable to BindToObject|Could not find video device|Error opening input|I/O error') {
  Write-Host "`n[FAIL] FFmpeg ngoài app cũng không mở được camera." -ForegroundColor Red
  Write-Host "Hãy bật: Settings > Privacy & security > Camera > Let desktop apps access your camera." -ForegroundColor Yellow
  Write-Host "Sau đó rút/cắm lại webcam hoặc restart app rồi test lại." -ForegroundColor Yellow
  exit 3
}

Write-Host "`n[OK] FFmpeg mở được camera. Nếu app còn lỗi thì gửi lại log có dòng [LiveFfmpegCheck]." -ForegroundColor Green
exit 0
