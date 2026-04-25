import React, {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import {Image, StyleSheet, View} from 'react-native';

import images from 'assets';

type CameraSource = 'back' | 'front' | 'external';
type Props = {
  style?: any;
  children?: React.ReactNode;
  setIsCameraReady?: (isReady: boolean) => void;
};

type RecordingSnapshot = {
  state: 'idle' | 'starting' | 'recording' | 'stopping';
  activeBackend: 'windows-fallback' | null;
  source: CameraSource;
  isRecording: boolean;
};

const getCurrentSource = (): CameraSource => {
  const value = (globalThis as any).__APLUS_CURRENT_CAMERA_SOURCE__;
  return value === 'front' || value === 'external' ? value : 'back';
};

const ensureWindowsCameraGlobals = () => {
  const current = getCurrentSource();
  (globalThis as any).__APLUS_CURRENT_CAMERA_SOURCE__ = current;
  (globalThis as any).__APLUS_AVAILABLE_CAMERA_SOURCES__ = ['back', 'front'];
  (globalThis as any).__APLUS_UVC_PRESENT__ = false;
};

const setRecordingSnapshot = (snapshot: RecordingSnapshot) => {
  (globalThis as any).__APLUS_CAMERA_RECORDING_SNAPSHOT__ = snapshot;
};

const buildRecordingPath = () => {
  const source = getCurrentSource();
  return `C:/AplusScoreWindows/ReplayBuffer/windows_${source}_${Date.now()}.mp4`;
};

const VideoWindows = forwardRef<any, Props>((props, ref) => {
  const {setIsCameraReady} = props;
  const recordingRef = useRef<{
    path: string;
    onRecordingFinished?: (video: {path: string}) => void;
    onRecordingError?: (error: any) => void;
  } | null>(null);

  const markReady = () => {
    ensureWindowsCameraGlobals();
    setRecordingSnapshot({
      state: recordingRef.current ? 'recording' : 'idle',
      activeBackend: recordingRef.current ? 'windows-fallback' : null,
      source: getCurrentSource(),
      isRecording: !!recordingRef.current,
    });
    setIsCameraReady?.(true);
  };

  useImperativeHandle(ref, () => ({
    startRecording: async (options?: any) => {
      ensureWindowsCameraGlobals();

      if (recordingRef.current) {
        return;
      }

      const path = String(options?.path || buildRecordingPath());
      recordingRef.current = {
        path,
        onRecordingFinished: options?.onRecordingFinished,
        onRecordingError: options?.onRecordingError,
      };

      setRecordingSnapshot({
        state: 'recording',
        activeBackend: 'windows-fallback',
        source: getCurrentSource(),
        isRecording: true,
      });
      setIsCameraReady?.(true);
    },
    stopRecording: async () => {
      const recording = recordingRef.current;
      recordingRef.current = null;

      setRecordingSnapshot({
        state: 'idle',
        activeBackend: null,
        source: getCurrentSource(),
        isRecording: false,
      });
      setIsCameraReady?.(true);

      if (recording?.onRecordingFinished) {
        setTimeout(() => {
          recording.onRecordingFinished?.({path: recording.path});
        }, 0);
      }

      return recording?.path;
    },
    startLive: async () => false,
    stopLive: async () => false,
    setZoom: async () => 1,
    getZoomInfo: async () => ({
      supported: false,
      minZoom: 1,
      maxZoom: 1,
      zoom: 1,
      source: getCurrentSource(),
    }),
    getRecordingInfo: () => ({
      state: recordingRef.current ? 'recording' : 'idle',
      activeBackend: recordingRef.current ? 'windows-fallback' : null,
      source: getCurrentSource(),
      isRecording: !!recordingRef.current,
    }),
  }));

  useEffect(() => {
    markReady();

    const timeout = setTimeout(markReady, 250);

    return () => {
      clearTimeout(timeout);
      setRecordingSnapshot({
        state: 'idle',
        activeBackend: null,
        source: getCurrentSource(),
        isRecording: false,
      });
    };
    // setIsCameraReady must stay live; the parent callback is stable enough for this use.
  }, [setIsCameraReady]);

  return (
    <View style={[styles.container, props.style]}>
      <Image
        source={images.logoSmall || images.logoFilled || images.logo}
        resizeMode="contain"
        style={styles.logo}
      />
      {props.children}
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
