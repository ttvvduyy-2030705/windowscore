$ErrorActionPreference = 'Stop'
$Url = 'https://aplus-live-backend.onrender.com/live/youtube/build-info'
Write-Host "Checking backend build: $Url"
try {
  $r = Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec 20
  $r | ConvertTo-Json -Depth 10
  if ($r.backendBuild -ne 'youtube-ultralow-20260530-strict-v2') {
    Write-Host "ERROR: Render backend is NOT running the required ultra-low latency build." -ForegroundColor Red
    exit 1
  }
  Write-Host "OK: Render backend build is correct." -ForegroundColor Green
} catch {
  Write-Host "ERROR: Cannot verify backend build: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
