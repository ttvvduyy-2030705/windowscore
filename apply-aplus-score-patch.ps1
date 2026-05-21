param(
  [string]$ProjectRoot = "C:\project\windowscore"
)

$ErrorActionPreference = "Stop"

$manifestPath = Join-Path $ProjectRoot "windows\billiardsgrade\Package.appxmanifest"
$appJsonPath = Join-Path $ProjectRoot "app.json"
$assetsSource = Join-Path $PSScriptRoot "windows\billiardsgrade\Assets"
$assetsTarget = Join-Path $ProjectRoot "windows\billiardsgrade\Assets"

if (!(Test-Path $manifestPath)) {
  throw "Cannot find Package.appxmanifest at: $manifestPath"
}
if (!(Test-Path $assetsTarget)) {
  throw "Cannot find Assets folder at: $assetsTarget"
}

Write-Host "Copying Aplus Score icon assets..."
Copy-Item -Path (Join-Path $assetsSource "*.png") -Destination $assetsTarget -Force

Write-Host "Updating Windows app manifest display name..."
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8
$manifest = $manifest -replace '<DisplayName>[^<]*</DisplayName>', '<DisplayName>Aplus Score</DisplayName>'
$manifest = $manifest -replace '<PublisherDisplayName>[^<]*</PublisherDisplayName>', '<PublisherDisplayName>Aplus Billiards</PublisherDisplayName>'
$manifest = $manifest -replace 'DisplayName="[^"]*"', 'DisplayName="Aplus Score"'
$manifest = $manifest -replace 'Description="[^"]*"', 'Description="Aplus Score"'
$manifest = $manifest -replace '(<uap:VisualElements[^>]*?)BackgroundColor="[^"]*"', '$1BackgroundColor="transparent"'
$manifest = $manifest -replace '(<uap:SplashScreen[^>]*?)BackgroundColor="[^"]*"', '$1BackgroundColor="#000000"'
Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8

if (Test-Path $appJsonPath) {
  Write-Host "Updating app.json displayName only, keeping internal name unchanged..."
  $appJson = Get-Content $appJsonPath -Raw -Encoding UTF8
  $appJson = $appJson -replace '"displayName"\s*:\s*"[^"]*"', '"displayName": "Aplus Score"'
  Set-Content -Path $appJsonPath -Value $appJson -Encoding UTF8
}

Write-Host "Done. App display name is now Aplus Score. Icon assets have been replaced."
Write-Host "Next: clean old build folders and rebuild MSIX package."
