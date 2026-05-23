$ErrorActionPreference = 'Stop'

$root = Get-Location
$indexPath = Join-Path $root 'src\scenes\game\game-play\console\index.tsx'
$headlessPath = Join-Path $root 'src\scenes\game\game-play\console\AplusWebLiveCountdownSync.tsx'

if (!(Test-Path $indexPath)) {
  throw "Không tìm thấy file: $indexPath. Hãy chạy script ở thư mục gốc app Windows, ví dụ C:\project\windowscore"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$indexPath.bak-remove-duplicate-aplus-sync-$stamp"
Copy-Item $indexPath $backup -Force
Write-Host "Backup created: $backup"

$content = Get-Content $indexPath -Raw
$before = $content

# Remove headless duplicate import. Keep the existing ViewModel/service based Aplus live sync.
$content = [regex]::Replace(
  $content,
  "(?m)^\s*import\s+AplusWebLiveCountdownSync\s+from\s+['\"]\.\/AplusWebLiveCountdownSync['\"];\s*\r?\n",
  ""
)

# Remove all self-closing usages of <AplusWebLiveCountdownSync ... /> across multiple lines.
$content = [regex]::Replace(
  $content,
  "\r?\n\s*<AplusWebLiveCountdownSync\b[\s\S]*?\/>",
  ""
)

Set-Content -Path $indexPath -Value $content -Encoding UTF8

$removedImport = ($before -match 'AplusWebLiveCountdownSync') -and ($content -notmatch "import\s+AplusWebLiveCountdownSync")
$remaining = Select-String -Path $indexPath -Pattern 'AplusWebLiveCountdownSync' -SimpleMatch -ErrorAction SilentlyContinue

if ($remaining) {
  Write-Warning "Vẫn còn AplusWebLiveCountdownSync trong index.tsx. In ra để kiểm tra:"
  $remaining | ForEach-Object { Write-Warning $_.Line }
} else {
  Write-Host "OK: Đã bỏ toàn bộ AplusWebLiveCountdownSync khỏi console/index.tsx"
}

if (Test-Path $headlessPath) {
  $disabledPath = "$headlessPath.disabled-$stamp"
  Rename-Item $headlessPath $disabledPath -Force
  Write-Host "Đã đổi tên file headless sync để tránh chạy nhầm: $disabledPath"
}

Write-Host ""
Write-Host "Xong. Bây giờ đóng hẳn app Windows rồi chạy lại: npm run windows"
Write-Host "Sau đó dùng panel Kết nối web Aplus cũ: Tải lại -> chọn giải -> nhập mã trận -> Kiểm tra."
