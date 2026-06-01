# YouTube microphone explicit DirectShow device fix

Build: youtube-microphone-explicit-dshow-device-20260601

The user verified manually that FFmpeg can see these audio devices:

- Microphone (2K Web Camera-Audio)
- Microphone (Realtek(R) Audio)

Previous app builds only tried `audio=default` and `audio=2K Web Camera`, which fail because the actual DirectShow audio device name includes `Microphone (...)`.

This patch adds explicit microphone candidates before falling back to default/webcam/silent.
