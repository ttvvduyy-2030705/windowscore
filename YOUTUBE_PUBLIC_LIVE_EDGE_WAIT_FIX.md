# YouTube public live edge wait fix

Fixes the case where the app enters gameplay after FFmpeg starts, but the YouTube watch page still shows the scheduled/offline card because the public player has not caught the camera stream yet.

Changes:
- Do not treat `Redundant transition` as immediate success anymore.
- Keep FFmpeg ingesting while waiting for YouTube public live edge.
- Require several redundant transition confirmations before entering gameplay.
- Add a short pre-roll delay after YouTube reports live/redundant transition so the camera appears before the app enters the match.
- Leaves mic disabled/silent as in stable restore; this fix is only for stable live startup.
