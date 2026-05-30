$cpp = Join-Path $PSScriptRoot "windows\billiardsgrade\WindowsFfmpegLiveModule.cpp"
$ts = Join-Path $PSScriptRoot "src\services\youtubeNativeLive.windows.ts"
$c = Get-Content $cpp -Raw
$t = Get-Content $ts -Raw
if ($c -match 'AplusScoreLiveOverlay\overlay-snapshot\.json' -and
    $c -match 'NormalizeOverlaySnapshotPath' -and
    $c -match 'LiveOverlaySnapshot v62' -and
    $t -match 'direct-tempstate-path-v62') {
  Write-Host 'OK: v62 overlay direct TempState path fix is installed.' -ForegroundColor Green
  exit 0
}
Write-Host 'ERROR: v62 overlay fix is NOT installed correctly.' -ForegroundColor Red
exit 1
