# YouTube live delay root cause

Metro log proves the Windows app is already sending FFmpeg with low encoder buffer (`bitrate=4500k`, `vbv_bufsize=900`, `keyint=15`). The remaining 15-30s delay is not caused by the React overlay or FFmpeg command.

The YouTube broadcast is still being created by the Render backend as normal latency:

```json
"latencyPreference": "normal",
"enableLowLatency": false
```

That means `aplus-live-backend.onrender.com` has not been deployed with the ultra-low latency backend code, or YouTube is rejecting that backend payload and normalizing the broadcast.

This package includes a guard in the Windows app: if the backend response is missing `session.latencyPreference: "ultraLow"`, the app stops immediately with a clear message instead of starting another delayed live.

Required test after deploying backend:

```powershell
curl https://aplus-live-backend.onrender.com/live/youtube/build-info
```

Expected:

```json
{"ok":true,"backendBuild":"youtube-ultralow-20260530-strict-v2","expectedLatencyPreference":"ultraLow"}
```

Then create a fresh YouTube live. In Metro log you must see:

```text
[YouTube LowDelay Guard] backend latency check { latencyPreference: "ultraLow", enableDvr: false, enableAutoStop: false }
```

If it says `missing` or `normal`, Render is still running the old backend and delay will remain.
