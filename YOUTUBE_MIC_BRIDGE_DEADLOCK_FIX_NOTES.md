# YouTube microphone bridge deadlock fix

This build is based on the uploaded `windowscore-youtube-microphone-external-bridge-fix` source.

Changes:

- Fixes native `resource deadlock would occur` during microphone attempts.
- Starts/replaces the external microphone bridge before re-entering `g_processMutex`.
- Keeps YouTube ingest alive if microphone bridge cannot start by replacing failed DirectShow audio input with silent fallback instead of leaving FFmpeg stuck on a failing `audio=...` input.
- Keeps the current stable video/overlay path unchanged: MediaCapture raw BGRA pipe + React overlay snapshot + 1080p YouTube RTMP.

Expected successful log:

```text
[MicBridge] Mic bridge scheduled for Microphone (2K Web Camera-Audio) on udp://127.0.0.1:xxxxx
micBridgeActive: true
Input #1, s16le, from 'udp://127.0.0.1:xxxxx...'
```

If the bridge cannot start, YouTube should still go live with silent fallback instead of staying at “upcoming/sắp diễn ra”.
