# billiardsgrade Windows

This repository is Windows-only and is intended to build and run the React Native Windows app. Mobile native projects have been removed.

## Requirements

- Windows 10/11
- Visual Studio 2022 with C++/UWP tooling
- Node.js compatible with the project dependencies
- FFmpeg on PATH or configured in the app when using local Windows livestream

## Run in debug

```powershell
npm install
npx react-native start --reset-cache
```

In another terminal:

```powershell
npx react-native run-windows --arch x64
```

## Useful scripts

```powershell
npm run windows
npm run windows:debug
npm run windows:release
npm run windows:autolink
npm run clean:windows
```

## Windows livestream

The Windows livestream path uses the Windows app, the production auth backend only for account/live-session creation, and local FFmpeg for RTMP streaming. The video stream is pushed directly from the PC to YouTube; it is not sent through the backend.
