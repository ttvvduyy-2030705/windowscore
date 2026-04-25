import React, {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import {Image, Platform, StyleSheet, View} from 'react-native';

import images from 'assets';
import WindowsNativeCameraView from './WindowsNativeCameraView';

type Props = {
  style?: any;
  children?: React.ReactNode;
  overlayContent?: React.ReactNode;
  setIsCameraReady?: (isReady: boolean) => void;
  cameraScaleMode?: 'contain' | 'cover';
};

const DEBUG_WINDOWS_CAMERA = true;

const debugWindowsCamera = (...args: any[]) => {
  if (DEBUG_WINDOWS_CAMERA) {
    console.log(...args);
  }
};

const VideoWindows = forwardRef<any, Props>((props, ref) => {
  const {setIsCameraReady} = props;
  const lastRecordingPathRef = useRef<string>('');

  useImperativeHandle(ref, () => ({
    startRecording: async (options?: any) => {
      lastRecordingPathRef.current =
        String(options?.path || '') || `C:/AplusScoreWindows/recording-${Date.now()}.mov`;

      // Windows preview is native MediaCapture. Recording is intentionally mocked here
      // so gameplay/replay flow does not block while the Windows recorder is added later.
      setTimeout(() => {
        options?.onRecordingFinished?.({path: undefined});
      }, 80);

      return lastRecordingPathRef.current;
    },
    stopRecording: async () => lastRecordingPathRef.current || undefined,
    startLive: async () => false,
    stopLive: async () => false,
    setZoom: async () => 1,
    getZoomInfo: async () => ({
      supported: false,
      minZoom: 1,
      maxZoom: 1,
      zoom: 1,
      source: 'windows',
    }),
  }));

  useEffect(() => {
    debugWindowsCamera('[WebCam] platform=windows', {
      platform: Platform.OS,
      branch: 'windows-native-mediacapture',
    });
    debugWindowsCamera('[WebCam] using Windows camera branch', {
      implementation: 'UWP MediaCapture + CaptureElement',
      selection: 'prefer external/usb camera, fallback to first available video device',
    });
    debugWindowsCamera('[WebCam] enumerate devices start');
    debugWindowsCamera('[Video] finalVisibleLayer=camera', {
      owner: 'Video.index.windows',
      fallback: 'black background + logo behind native preview if no camera is available',
    });

    // Native WindowsCameraView opens the real PC/USB webcam. Mark ready here so
    // game start is not blocked by Android/iOS VisionCamera state.
    setIsCameraReady?.(true);
  }, [setIsCameraReady]);

  return (
    <View style={[styles.container, props.style]}>
      <Image
        source={images.logoSmall || images.logoFilled || images.logo}
        resizeMode="contain"
        style={styles.fallbackLogo}
      />
      <WindowsNativeCameraView style={styles.nativeCamera} />
      {props.children}
      {props.overlayContent}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  nativeCamera: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  fallbackLogo: {
    position: 'absolute',
    width: '34%',
    height: '34%',
    minWidth: 96,
    minHeight: 54,
    maxWidth: 240,
    maxHeight: 136,
  },
});

export default VideoWindows;
