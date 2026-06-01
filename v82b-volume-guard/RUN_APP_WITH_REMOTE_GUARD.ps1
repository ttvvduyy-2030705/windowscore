$ErrorActionPreference = "Continue"
cd C:\project\windowscore

# Close old app/ffmpeg first.
taskkill /IM billiardsgrade.exe /F 2>$null
taskkill /IM ffmpeg.exe /F 2>$null

# Start the guard in a separate window. Keep it open while testing remote.
Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File',"$PWD\START_APLUS_REMOTE_VOLUME_GUARD.ps1"
Start-Sleep -Milliseconds 800

npx react-native run-windows
