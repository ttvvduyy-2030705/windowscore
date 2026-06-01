# YouTube low-delay live fix

Bản này sửa đúng nguyên nhân delay 15-30 giây trong log: backend tạo broadcast YouTube với `latencyPreference: normal` và `enableLowLatency: false`.

## Thay đổi chính

- Backend `/live/youtube/create` tạo broadcast với `contentDetails.latencyPreference = "ultraLow"`.
- Không gửi `enableLowLatency` khi dùng `ultraLow`, vì flag cũ này có thể làm YouTube normalize về `normal` latency.
- Sau khi bind stream, backend kiểm tra lại broadcast. Nếu YouTube chưa nhận `ultraLow`, backend tự gọi `liveBroadcasts.update` để ép lại.
- Nếu ultraLow bị YouTube từ chối, backend fallback sang `low` thay vì `normal`.
- App Windows giảm bitrate live YouTube xuống `4500k`, buffer encode `900k`, GOP khoảng 0.5 giây để giảm buffer ingest.

## Bắt buộc

Cần deploy lại backend Render (`aplus-live-backend.onrender.com`). Nếu chỉ chạy app Windows mà không deploy backend thì YouTube vẫn có thể tạo phiên `normal`, delay vẫn còn.

## Cách kiểm tra đúng bản

Sau khi tạo live, trong log backend/app phải thấy:

```text
[YouTube Live Create] latency applied ... latencyPreference: "ultraLow"
```

Hoặc trong response/status YouTube phải thấy:

```json
"latencyPreference": "ultraLow"
```

Nếu vẫn thấy:

```json
"latencyPreference": "normal",
"enableLowLatency": false
```

thì backend Render vẫn chưa chạy bản mới hoặc YouTube không nhận ultraLow cho phiên đó.
