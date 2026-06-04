Aplus Remote Raw Input Probe v92

Mục đích:
- Không sửa code app.
- Chỉ kiểm tra xem 2 nút Stop và Break có phát tín hiệu HID/RawInput vào Windows hay không.

Cách dùng:
1. Copy file RUN_RAW_REMOTE_PROBE.ps1 vào C:\project\windowscore hoặc mở trực tiếp từ Downloads.
2. Chạy:
   powershell -Sta -ExecutionPolicy Bypass -File .\RUN_RAW_REMOTE_PROBE.ps1
3. Một cửa sổ nhỏ hiện lên. Click vào cửa sổ đó.
4. Bấm riêng nút Stop 1 lần, rồi bấm riêng nút Break 1 lần.
5. Copy các dòng bắt đầu bằng [RAW] gửi lại.

Nếu không có dòng [RAW] nào khi bấm Stop/Break:
- Remote không gửi 2 nút đó vào Windows ở chế độ hiện tại.
- Khi đó app không thể bắt bằng keyboard hook; phải đổi mode remote hoặc làm BLE GATT/custom HID sâu hơn.
