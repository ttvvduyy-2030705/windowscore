# YouTube quality + low-delay balance fix

This build keeps the verified YouTube `ultraLow` backend path, but improves live picture quality after the previous 720p low-delay build looked slightly soft.

Changes:

- YouTube live session now requests `1080p / 30fps` instead of `720p / 30fps`.
- Windows FFmpeg live config now outputs `1920x1080` at `5200k` instead of `1280x720` at `2800k`.
- FFmpeg prefers DirectShow `mjpeg1080` camera input first, so the webcam is not stuck at the soft default 640x480 feed.
- If `mjpeg1080` is not supported by a camera, FFmpeg automatically falls back to the old `default` DirectShow mode.
- x264 preset changed from `ultrafast` to `superfast` with `zerolatency` to improve compression/detail without adding B-frames.
- VBV buffer remains small (`900k` around 5200k bitrate) to avoid bringing back the large YouTube delay.

Expected Metro signs:

- `latencyPreference: "ultraLow"`
- `resolution: "1920x1080"`
- `bitrate: "5200k"`
- `directShowInputMode: "mjpeg1080"` if the camera supports it; otherwise it will retry `default`.
