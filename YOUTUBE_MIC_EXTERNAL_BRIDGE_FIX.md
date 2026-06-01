# YouTube microphone external bridge fix

Build: youtube-mic-external-bridge-v66

Problem seen in logs: manual PowerShell FFmpeg can see DirectShow microphones, but FFmpeg launched inside the packaged RNW app cannot enumerate audio devices and falls back to silent.

Fix:
- Keep the existing MediaCapture raw video pipe so overlay stays stable.
- For microphone audio, start a small scheduled-task FFmpeg mic bridge outside the packaged app context.
- The mic bridge captures DirectShow microphone audio and sends raw PCM to localhost UDP.
- The main live FFmpeg reads that localhost PCM input as audio track #1.
- Stop/end match now also stops and deletes the mic bridge scheduled task.

Expected logs:
- `captureSource: mediacapture-rawvideo-pipe-v66-external-mic-bridge-react-fullscreen-snapshot`
- `micBridgeActive: true`
- `Mic bridge scheduled for Microphone (2K Web Camera-Audio) on udp://127.0.0.1:xxxxx`
- FFmpeg stderr should show `Input #1, s16le, from 'udp://127.0.0.1:xxxxx...'` instead of `anullsrc`.
