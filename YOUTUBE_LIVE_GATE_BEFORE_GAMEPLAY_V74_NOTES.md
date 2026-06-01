# YouTube Live Gate Before Gameplay v74

Mục tiêu: không vào màn trận khi YouTube vẫn còn hiển thị "sắp diễn ra".

Thay đổi chính:
- SettingsViewModel chờ YouTube trả trạng thái thật `broadcast=live` và `stream=active` rồi mới `navigateToGameplay`.
- Không coi `Redundant transition` là live thật nữa; chỉ coi là tín hiệu đang chuyển trạng thái và tiếp tục polling.
- youtubeLiveFlow không fake `live/active` khi backend trả `Redundant transition`.
- Backend `/live/youtube/status/:broadcastId` bắt lỗi `Redundant transition`, fetch lại trạng thái thật và trả về cho app thay vì trả 400.
- Giữ no-mic/anullsrc, không đụng lại luồng micro.

Log đúng cần thấy trước khi vào trận:
- `[Settings YouTube Live Status Poll] ... broadcastStatus: "live", streamStatus: "active"`
- Sau đó mới có `restored prestarted live from settings` trong GamePlay.
