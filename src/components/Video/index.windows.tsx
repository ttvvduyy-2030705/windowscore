import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useRef} from 'react';
import {Image, NativeModules, Platform, StyleSheet, View} from 'react-native';
import RNFS from 'react-native-fs';

import images from 'assets';
import {REPLAY_ROOT} from 'services/replay/localReplay';
import WindowsNativeCameraView from './WindowsNativeCameraView';

type Props = {
  style?: any;
  children?: React.ReactNode;
  overlayContent?: React.ReactNode;
  setIsCameraReady?: (isReady: boolean) => void;
  cameraScaleMode?: 'contain' | 'cover';
};

type RecordingCallbacks = {
  onRecordingFinished?: (video: {path?: string}) => void;
  onRecordingError?: (error: any) => void;
  webcamFolderName?: string;
  segmentIndex?: number;
  path?: string;
};

const DEBUG_WINDOWS_CAMERA = true;

const debugWindowsCamera = (...args: any[]) => {
  if (DEBUG_WINDOWS_CAMERA) {
    console.log(...args);
  }
};

const sanitizeFolderName = (value?: string) => {
  const raw = String(value || '').trim();
  return raw.replace(/[<>:"/\\|?*]+/g, '_') || `windows_match_${Date.now()}`;
};

const getWindowsCameraRecordingModule = () => {
  const modules = NativeModules as any;
  return modules?.WindowsCameraRecordingModule || modules?.WindowsCameraRecording || null;
};

const VideoWindows = forwardRef<any, Props>((props, ref) => {
  const {setIsCameraReady} = props;
  const lastRecordingPathRef = useRef<string>('');
  const recordingCallbacksRef = useRef<RecordingCallbacks | null>(null);
  const recordingStateRef = useRef<'idle' | 'starting' | 'recording' | 'stopping'>('idle');

  const buildRecordingPath = useCallback(async (options?: RecordingCallbacks) => {
    if (options?.path) {
      const parent = String(options.path).replace(/[\\/][^\\/]+$/, '');
      if (parent && parent !== options.path) {
        await RNFS.mkdir(parent).catch(() => undefined);
      }
      return String(options.path);
    }

    const folderName = sanitizeFolderName(options?.webcamFolderName);
    const folderPath = `${REPLAY_ROOT}/${folderName}`;
    await RNFS.mkdir(folderPath).catch(() => undefined);

    const segmentIndex = Number.isFinite(Number(options?.segmentIndex))
      ? Number(options?.segmentIndex)
      : Date.now();
    const indexLabel = segmentIndex < 10 ? `0${segmentIndex}` : String(segmentIndex);

    return `${folderPath}/webcam_${indexLabel}_${Date.now()}.mp4`;
  }, []);

  useImperativeHandle(ref, () => ({
    startRecording: async (options?: RecordingCallbacks) => {
      const nativeRecorder = getWindowsCameraRecordingModule();

      if (!nativeRecorder?.startRecording) {
        const error = new Error('WindowsCameraRecordingModule.startRecording is not available');
        console.log('[Recording] error', error.message);
        options?.onRecordingError?.(error);
        return undefined;
      }

      try {
        recordingStateRef.current = 'starting';
        recordingCallbacksRef.current = options || null;

        const outputPath = await buildRecordingPath(options);
        lastRecordingPathRef.current = outputPath;

        console.log('[Recording] platform=windows');
        console.log('[Recording] start requested');
        console.log('[Recording] selected camera/input source', 'WindowsNativeCameraView');
        console.log('[Recording] output path', outputPath);

        const actualPath = await nativeRecorder.startRecording(outputPath);
        const finalPath = String(actualPath || outputPath);

        lastRecordingPathRef.current = finalPath;
        recordingStateRef.current = 'recording';
        console.log('[Recording] file created', finalPath);

        return finalPath;
      } catch (error) {
        recordingStateRef.current = 'idle';
        console.log('[Recording] error', error);
        options?.onRecordingError?.(error);
        return undefined;
      }
    },
    stopRecording: async () => {
      const nativeRecorder = getWindowsCameraRecordingModule();
      const callbacks = recordingCallbacksRef.current;

      console.log('[Recording] platform=windows');
      console.log('[Recording] stop requested');

      if (!nativeRecorder?.stopRecording) {
        const error = new Error('WindowsCameraRecordingModule.stopRecording is not available');
        console.log('[Recording] error', error.message);
        callbacks?.onRecordingError?.(error);
        recordingStateRef.current = 'idle';
        return lastRecordingPathRef.current || undefined;
      }

      try {
        recordingStateRef.current = 'stopping';
        const actualPath = await nativeRecorder.stopRecording();
        const finalPath = String(actualPath || lastRecordingPathRef.current || '');

        if (finalPath) {
          lastRecordingPathRef.current = finalPath;
          console.log('[Recording] finalized path', finalPath);
          callbacks?.onRecordingFinished?.({path: finalPath});
          console.log('[Replay] video discovered', finalPath);
        } else {
          const error = new Error('Windows recording stopped without a finalized path');
          console.log('[Recording] error', error.message);
          callbacks?.onRecordingError?.(error);
        }

        recordingCallbacksRef.current = null;
        recordingStateRef.current = 'idle';
        return finalPath || undefined;
      } catch (error) {
        console.log('[Recording] error', error);
        callbacks?.onRecordingError?.(error);
        recordingCallbacksRef.current = null;
        recordingStateRef.current = 'idle';
        return lastRecordingPathRef.current || undefined;
      }
    },
    getRecordingInfo: () => ({
      state: recordingStateRef.current,
      activeBackend: 'windows-native',
      source: 'external',
      isRecording: recordingStateRef.current === 'recording' || recordingStateRef.current === 'starting',
      path: lastRecordingPathRef.current || undefined,
    }),
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
  }), [buildRecordingPath]);

  useEffect(() => {
    debugWindowsCamera('[WebCam] platform=windows', {
      platform: Platform.OS,
      branch: 'windows-native-mediacapture',
    });
    debugWindowsCamera('[WebCam] using Windows camera branch', {
      implementation: 'UWP MediaCapture + CaptureElement',
      recording: 'WindowsCameraRecordingModule + MediaCapture.StartRecordToStorageFileAsync',
      selection: 'prefer external/usb camera, fallback to first available video device',
    });
    debugWindowsCamera('[WebCam] enumerate devices start');
    debugWindowsCamera('[Video] finalVisibleLayer=camera', {
      owner: 'Video.index.windows',
      fallback: 'black background + logo behind native preview if no camera is available',
    });

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
