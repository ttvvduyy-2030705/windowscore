# YouTube near-parallel no-mic v2

Goal: keep the stable no-microphone live path, but reduce score/overlay latency without returning to the unstable g=6/vbv=360 build.

Changes:
- Microphone remains fully disabled.
- Audio remains lavfi anullsrc -> AAC, so YouTube gets a valid A/V ingest.
- GOP tightened from about 10 frames to about 8 frames at 30fps.
- keyint_min tightened from 6 to 4.
- VBV buffer tightened from 700k to 520k at the current 5200k bitrate.
- Added RTMP low-latency protocol hints: rtmp_live=live and tcp_nodelay=1.
- FFmpeg native process now starts at NORMAL priority instead of BELOW_NORMAL priority to avoid extra scheduling delay.

Expected logs:
- audioInputMode: anullsrc
- Input #1, lavfi, from anullsrc=channel_layout=stereo:sample_rate=44100
- keyint=8 or g 8
- vbv_bufsize=520
- v72 near-parallel-anullsrc-no-mic
