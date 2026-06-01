# YouTube Live Microphone Fix

Added microphone audio to the Windows YouTube live pipeline.

What changed:

- YouTube FFmpeg live now tries to include microphone audio automatically.
- Preferred order:
  1. DirectShow microphone device if FFmpeg can enumerate it.
  2. WASAPI default Windows capture device if DirectShow audio is unavailable.
  3. Silent audio fallback so live still starts if no microphone is available.
- Existing 1080p / 5200k / ultraLow / overlay flicker fix is preserved.
- Logs now include `audioEnabled`, `audioInputMode`, and `audioDeviceName` in `LiveFfmpegCommand`, `WindowsLiveStart`, and `LiveState`.

How to test:

1. In Windows Settings, set the desired mic as the default input device.
2. Run the app and start YouTube live.
3. In Metro log, check for either:
   - `audioEnabled: true`, `audioInputMode: "dshow"`, or
   - `audioEnabled: true`, `audioInputMode: "wasapi-default"`.
4. Open YouTube live from another browser/device and verify the microphone sound.

If there is no sound:

- Confirm the mic is selected as Windows default input.
- Confirm Windows allows microphone access for desktop apps.
- If FFmpeg cannot open any mic, the app intentionally falls back to silent audio instead of crashing.
