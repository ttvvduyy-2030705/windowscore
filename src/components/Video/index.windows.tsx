import React, {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import {Image, Platform, StyleSheet, View} from 'react-native';

import images from 'assets';

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

      // Windows native recording is not implemented in this JS-only branch.
      // Keep the gameplay/replay flow non-blocking and return a stable value.
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
    debugWindowsCamera('[WebCam] platform', {
      platform: Platform.OS,
      branch: 'windows-js-fallback',
    });
    debugWindowsCamera('[WebCam] windows camera branch', {
      implementation: 'js-fallback-no-webview',
      nativePreviewAvailable: false,
    });
    debugWindowsCamera('[WebCam] camera device not found', {
      reason: 'No RNW native camera preview module is registered in this repo',
    });
    debugWindowsCamera('[Video] finalVisibleLayer', {
      layer: 'Video.fallback',
      reason: 'No external camera dependency is imported',
    });

    // Do not block gameplay on Windows while native camera preview is absent.
    setIsCameraReady?.(true);
  }, [setIsCameraReady]);

  useEffect(() => {
    debugWindowsCamera('[Video] fallback logo rendered');
  }, []);

  return (
    <View style={[styles.container, props.style]}>
      <Image
        source={images.logoSmall || images.logoFilled || images.logo}
        resizeMode="contain"
        style={styles.logo}
      />
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
  logo: {
    width: '34%',
    height: '34%',
    minWidth: 96,
    minHeight: 54,
    maxWidth: 240,
    maxHeight: 136,
  },
});

export default VideoWindows;
