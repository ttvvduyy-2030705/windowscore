This package fixes GamePlayViewModel.tsx only.
It moves the 1-second selected-match live sync to the correct place after buildAplusLiveRealtimePayload is declared.
It does not use the hidden AplusWebLiveCountdownSync component.

Usage:
1. Copy GamePlayViewModel.tsx and apply-selected-match-update-fix.ps1 into C:\project\windowscore
2. Run:
   powershell -ExecutionPolicy Bypass -File .\apply-selected-match-update-fix.ps1
3. Check:
   Get-ChildItem .\src -Recurse -Include *.ts,*.tsx | Select-String "AplusWebLiveCountdownSync|SELECTED_MATCH_REALTIME_1S_SYNC_FINAL"
4. Close the Windows app completely and run:
   npm run windows
