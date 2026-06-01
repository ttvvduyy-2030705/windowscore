# YouTube microphone permission prime fix

Problem observed:
- Manual PowerShell `ffmpeg -list_devices true -f dshow -i dummy` can see:
  - `Microphone (2K Web Camera-Audio)`
  - `Microphone (Realtek(R) Audio)`
- But FFmpeg launched from the packaged Windows app cannot enumerate audio devices and falls back to silent.

Fix:
- Before FFmpeg device probing and before FFmpeg live start, native Windows now initializes a small WinRT `MediaCapture` session with `StreamingCaptureMode::Audio`.
- This primes/requests Windows microphone access for the packaged app so child FFmpeg can see DirectShow microphone devices.
- `ListDevices` now returns/logs `microphoneAccessPrimed` and `microphoneAccessSummary`.

Test:
1. Rebuild native app clean.
2. If Windows asks for microphone permission for Aplus Score, choose Allow.
3. Start a fresh YouTube live.
4. Confirm logs show audio device, ideally:
   `audioInputMode: "dshow"`
   `audioDeviceName: "Microphone (2K Web Camera-Audio)"`
5. FFmpeg stderr should no longer fall back to `audioInputMode: "silent"`.
