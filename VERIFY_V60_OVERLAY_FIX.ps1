$cpp = Join-Path $PSScriptRoot "windows\billiardsgrade\WindowsFfmpegLiveModule.cpp"
$js = Join-Path $PSScriptRoot "src\services\youtubeNativeLive.windows.ts"
if (!(Test-Path $cpp)) { throw "Missing $cpp" }
if (!(Test-Path $js)) { throw "Missing $js" }
$cppText = Get-Content $cpp -Raw
$jsText = Get-Content $js -Raw
if ($cppText -notmatch "ApplicationData::Current\(\)\.TemporaryFolder") { throw "V60 check failed: C++ does not read ApplicationData.TemporaryFolder" }
if ($cppText -notmatch "snapshotPathFromMeta") { throw "V60 check failed: C++ does not read snapshotPath from meta" }
if ($jsText -notmatch "direct-tempstate-path-v60") { throw "V60 check failed: JS still not using direct TempState snapshot path" }
if ($jsText -match "RNFS\.copyFile\(normalizedSource") { throw "V60 check failed: JS still copies snapshot file" }
Write-Host "OK: v60 overlay fix installed - snapshot uses direct TempState path, no copy." -ForegroundColor Green
