# YouTube startup delay stabilize fix

Mục tiêu: giảm độ trễ ban đầu của YouTube Ultra Low Latency.

Thay đổi:
- Giữ backend ultraLow hiện tại.
- Chuyển YouTube live stream từ 1080p/4500k xuống 720p/2800k để YouTube ingest/player cần ít buffer hơn.
- FFmpeg scale/pad theo width/height cấu hình thay vì hardcode 1920x1080.
- Giảm VBV buffer xuống 600k với bitrate thấp.
- Tăng thời gian chờ trong màn Settings sau khi YouTube báo LIVE: redundant transition 15s, bình thường 12s, để khi vào trận thì player đã ổn định ở live edge hơn.

Kỳ vọng:
- Lúc mới mở phiên có thể vẫn cần vài giây để YouTube player bám live edge.
- Khi vào trận và bấm điểm/khởi động, độ trễ thực tế nên ổn định hơn quanh 2-3s, tránh pha đầu 8-10s.
