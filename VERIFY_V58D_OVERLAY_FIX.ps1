$cpp = Join-Path $PSScriptRoot "windows\billiardsgrade\WindowsFfmpegLiveModule.cpp"
if (!(Test-Path $cpp)) {
  Write-Error "Không thấy WindowsFfmpegLiveModule.cpp ở: $cpp"
  exit 1
}
$content = Get-Content $cpp -Raw
if ($content -match 'Microsoft\.UI\.Xaml\.Media\.Imaging') {
  Write-Error "FAIL: Vẫn còn include Microsoft.UI.Xaml.Media.Imaging. Bạn chưa đè đúng file."
  exit 1
}
if ($content -notmatch 'Windows\.UI\.Xaml\.Media\.Imaging') {
  Write-Error "FAIL: Không thấy include Windows.UI.Xaml.Media.Imaging."
  exit 1
}
if ($content -match 'XamlUIService::FromContext\(reactContext\)') {
  Write-Error "FAIL: Vẫn còn FromContext(reactContext) gây lỗi C2664."
  exit 1
}
if ($content -notmatch 'XamlUIService::FromContext\(reactContext\.Handle\(\)\)') {
  Write-Error "FAIL: Không thấy FromContext(reactContext.Handle())."
  exit 1
}
Write-Host "OK: WindowsFfmpegLiveModule.cpp đã là v58d" -ForegroundColor Green
