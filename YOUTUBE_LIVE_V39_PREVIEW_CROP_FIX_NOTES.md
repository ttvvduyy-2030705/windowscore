# YouTube Live v39 - Camera preview crop fix

## Problem confirmed from the latest log

- YouTube OAuth and eligibility are OK.
- YouTube broadcast/stream creation is OK.
- v37 could go live because it used `gdigrab desktop`, but it exposed the whole operator desktop.
- v38 correctly disabled full desktop capture, but DirectShow still fails to open the webcam in the packaged Windows app:
  - `Unable to BindToObject for 2K Web Camera`
  - `Could not find video device with name [2K Web Camera]`
- The app also logs `native releaseForExternalUse unavailable`, so it cannot reliably hand the webcam from the RN/MediaCapture preview to FFmpeg DirectShow.

## v39 approach

Use FFmpeg `gdigrab` only for the measured camera preview rectangle inside the app, not the whole desktop.

This means:

- The app keeps showing the camera preview normally.
- FFmpeg crops exactly the camera preview area and sends that to YouTube.
- It does not capture the full desktop.
- It does not depend on DirectShow camera binding.

## Files changed

1. `src/services/livestream/WindowsFfmpegLiveEngine.ts`
   - Added `preview-crop` live mode.
   - Reads the measured camera preview rectangle from memory/AsyncStorage.
   - Builds FFmpeg command with:
     - `-f gdigrab`
     - `-offset_x <preview x>`
     - `-offset_y <preview y>`
     - `-video_size <preview width>x<preview height>`
     - `-i desktop`
   - Logs `preview-crop-gdigrab-camera-area-only` so it is clear this is not full desktop capture.

2. `src/scenes/game/game-play/console/webcam/index.tsx`
   - Measures the camera/video rectangle with `UIManager.measureInWindow`.
   - Stores it in `globalThis.__APLUS_WINDOWS_LIVE_PREVIEW_RECT__` and AsyncStorage.
   - Keeps the preview mounted during YouTube live.

3. `src/scenes/game/game-play/GamePlayViewModel.tsx`
   - Sets Windows YouTube live mode to `captureMode: 'preview-crop'`.
   - Stops trying to release the webcam for FFmpeg DirectShow.
   - Waits briefly for the camera preview rectangle to be measured before FFmpeg starts.

## Expected good log

Look for:

```txt
[WindowsLivePreviewCrop] measured
[WindowsLivePreviewCrop] mode: "preview-crop-gdigrab-camera-area-only"
[LiveDeviceList] reason: "preview-crop-camera-area-only-no-full-desktop-no-directshow"
[LiveFfmpegCommand] captureSource: "preview-crop-gdigrab"
[WindowsLiveStart] captureSource: "preview-crop-gdigrab-camera-area-only"
[LiveFfmpegProcess] status: "live"
[YouTube Live Status Poll] broadcastStatus: "live", streamStatus: "active"
```

Bad log that should no longer be used as production path:

```txt
captureSource: "desktop-gdigrab"
Capturing whole desktop as 1920x1080 at (0,0)
```

The new FFmpeg stderr will still mention `gdigrab`, but it should include `offset_x/offset_y/video_size` based on the measured preview area, not full desktop size.
