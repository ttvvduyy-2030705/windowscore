V85 Remote Stop Fix
====================
Mục tiêu:
- Map nút Stop vật lý của remote Windows (VK_MEDIA_STOP = 178) thành lệnh STOP trong app.
- Trong GamePlayViewModel, STOP chỉ dừng/pause countdown, không stop recording/live, không new game.

Cách chạy:
cd C:\project\windowscore
Expand-Archive -Force "$env:USERPROFILE\Downloads\windowscore-remote-v85-stop-fix.zip" .\v85-stop-fix
powershell -ExecutionPolicy Bypass -File .\v85-stop-fix\APPLY_V85_REMOTE_STOP_FIX.ps1
taskkill /IM billiardsgrade.exe /F 2>$null
npx react-native run-windows
