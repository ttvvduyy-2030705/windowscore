# YouTube live score update ultra-sync fix

Mục tiêu: tháo micro khỏi luồng live, giữ live ổn định, và giảm độ trễ cập nhật điểm/overlay xuống thấp nhất phía app.

Thay đổi chính:

- Không thay đổi lại micro. Live vẫn dùng `anullsrc` ổn định.
- Giảm throttle chụp React overlay từ 180ms xuống 45ms.
- Bỏ delay floor 40ms trước khi chụp overlay; điểm đổi là request snapshot gần như ngay.
- Native đọc overlay snapshot nhanh hơn, từ 80ms xuống 16ms.
- Ép encoder libx264 sang `ultrafast + zerolatency`.
- Giảm VBV buffer và GOP/keyframe còn khoảng 0.2 giây ở 30fps.
- Thêm `probesize/analyzeduration`, `sc_threshold 0`, `x264-params` và `avioflags direct` để giảm queue/buffer phía FFmpeg.

Lưu ý: bản này giảm trễ phía app/FFmpeg/overlay. YouTube public player vẫn có buffer riêng, nên không thể đảm bảo 0 giây tuyệt đối, nhưng đây là cấu hình ép sát realtime nhất mà vẫn giữ live ổn định.
