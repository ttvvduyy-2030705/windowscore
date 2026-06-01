# YouTube live overlay flicker fix

Build marker: `live-overlay-flicker-v64-no-native-fallback`

Changes:
- Disabled the old hand-drawn native overlay fallback in `WindowsFfmpegLiveModule.cpp`.
- Native layer now uses only the React fullscreen overlay PNG snapshot.
- If React is rewriting the overlay PNG and the bitmap fails to load for a frame, native keeps the last valid overlay instead of flashing to a placeholder.
- `updateYouTubeNativeOverlay` ignores transient empty/no-snapshot updates instead of writing `visible:false`, which prevents one-frame overlay disappear/reappear.
- HTML fallback overlay is now empty/transparent so the old A+Plus drawn overlay cannot appear.

Expected result:
- No more flashing between the real overlay and the old drawn overlay.
- No more momentary overlay off/on blinking during score/timer changes.
