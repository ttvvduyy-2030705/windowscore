# YouTube Live v40 DirectShow camera fix

Mục tiêu: bỏ hoàn toàn cách live toàn màn hình/crop màn hình. Luồng live Windows quay lại đúng camera-only bằng FFmpeg DirectShow.

## Vấn đề log trước đó

- YouTube OAuth/backend OK, broadcast tạo được.
- FFmpeg list thấy `2K Web Camera` nhưng khi mở bằng DirectShow thì fail:
  - `Unable to BindToObject for 2K Web Camera`
  - `Could not find video device with name [2K Web Camera]`
- Bản v37 live được vì dùng `gdigrab desktop`, nhưng đó là live màn hình, không đúng yêu cầu.
- Bản v38 camera-only vẫn fail vì JS không gọi được native release camera: log `releaseForExternalUse unavailable`.

## Sửa trong v40

### 1. Native release camera ngay bên trong WindowsFfmpegLiveModule.start()
File:
- `windows/billiardsgrade/WindowsFfmpegLiveModule.cpp`

Khi args FFmpeg có DirectShow video input (`-f dshow ... video=...`), native module tự gọi:
- `WindowsCameraReleaseForExternalUseAsync().get()`
- đợi thêm 1.4 giây
- rồi mới `CreateProcessW` chạy FFmpeg

Như vậy FFmpeg không còn phụ thuộc vào JS gọi release nữa.

### 2. Chạy FFmpeg từ thư mục desktop LocalAppData thật
File:
- `windows/billiardsgrade/WindowsFfmpegLiveModule.cpp`

Bản cũ copy/chạy FFmpeg từ thư mục MSIX package AC:
`C:\Users\...\AppData\Local\Packages\...\AC\AplusScore\ffmpeg\ffmpeg.exe`

Bản v40 copy FFmpeg sang:
`C:\Users\<user>\AppData\Local\AplusScore\ffmpeg\ffmpeg.exe`

Lý do: FFmpeg trong package AC có thể list camera nhưng fail BindToObject khi mở webcam trên máy test.

### 3. JS không còn gọi release native riêng
File:
- `src/scenes/game/game-play/GamePlayViewModel.tsx`

JS chỉ bật trạng thái khóa preview để unmount camera preview, chờ ngắn, rồi gọi native start. Việc release thật được làm trong native module.

### 4. FFmpeg không dùng desktop/crop
File:
- `src/services/livestream/WindowsFfmpegLiveEngine.ts`

`-nostdin` được đưa lên đầu args. Luồng production vẫn là camera-only DirectShow.

## Log mong muốn

Không được còn:
- `desktop-gdigrab`
- `Capturing whole desktop`
- `preview-crop`

Nên thấy:
- `camera-only-directshow-native-start-will-release-preview`
- `reason: camera-only-directshow-no-desktop-capture`
- `captureSource: directshow`
- ffmpegPath nên là `C:\Users\Administrator\AppData\Local\AplusScore\ffmpeg\ffmpeg.exe` hoặc `C:\ffmpeg\bin\ffmpeg.exe`, không phải `...\Packages\...\AC\...`
- `LiveFfmpegProcess status: live`
- YouTube `broadcastStatus: live`, `streamStatus: active`
