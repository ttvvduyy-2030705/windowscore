# YouTube load stable overlay fix

- Reverted the unstable gameplay auto-start flow.
- Keeps the user on the platform/setup loading screen while YouTube + FFmpeg start.
- Re-enables a safe native overlay fallback so early YouTube frames are not camera-only before the React gameplay snapshot exists.
- Once gameplay mounts and React snapshot is ready, the live stream switches to the exact snapshot overlay.
- Keeps 1080p / 5200k / MJPEG 1080 / ultraLow latency configuration from the balanced quality fix.
