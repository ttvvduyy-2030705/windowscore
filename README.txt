Aplus Score Windows patch
=========================

Patch này thay icon app Windows bằng logo A+ nền trong suốt và đổi tên hiển thị thành "Aplus Score".

Cách dùng:
1. Giải nén zip này.
2. Mở PowerShell Run as Administrator.
3. Chạy:
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   cd <thu_muc_giai_nen_patch>
   .\apply-aplus-score-patch.ps1 -ProjectRoot "C:\project\windowscore"

Script sẽ:
- Copy đè icon PNG vào windows\billiardsgrade\Assets
- Sửa Package.appxmanifest để đổi tên app thành Aplus Score
- Sửa app.json displayName, giữ nguyên name nội bộ để không hỏng ReactRootView ComponentName

Sau đó build lại package MSIX.
