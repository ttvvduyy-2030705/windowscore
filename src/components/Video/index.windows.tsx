import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useRef} from 'react';
import {Image, NativeModules, Platform, StyleSheet, View} from 'react-native';
import RNFS from 'react-native-fs';

import images from 'assets';
import {buildWindowsRecordingOutputPath} from 'services/replay/localReplay';
import WindowsNativeCameraView from './WindowsNativeCameraView';

type Props = {
  style?: any;
  children?: React.ReactNode;
  overlayContent?: React.ReactNode;
  setIsCameraReady?: (isReady: boolean) => void;
  cameraScaleMode?: 'contain' | 'cover';
  cameraRef?: React.Ref<any>;
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

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getTurboModule = (moduleName: string) => {
  try {
    const rn = require("react-native") as any;
    return rn?.TurboModuleRegistry?.get?.(moduleName) || null;
  } catch (error) {
    return null;
  }
};

const getWindowsCameraRecordingModule = () => {
  const modules = NativeModules as any;
  const nativeModule = modules?.WindowsCameraRecordingModule || modules?.WindowsCameraRecording;

  if (nativeModule?.startRecording || nativeModule?.stopRecording) {
    return nativeModule;
  }

  const turboModule =
    getTurboModule("WindowsCameraRecordingModule") ||
    getTurboModule("WindowsCameraRecording");

  if (turboModule?.startRecording || turboModule?.stopRecording) {
    return turboModule;
  }

  console.log("[Recording] WindowsCameraRecordingModule unavailable", {
    hasNativeModules: !!modules,
    nativeModuleKeys: Object.keys(modules || {}).filter(key => key.toLowerCase().includes("camera") || key.toLowerCase().includes("record")),
  });

  return null;
};

const VideoWindows = forwardRef<any, Props>((props, ref) => {
  const {setIsCameraReady} = props;
  const lastRecordingPathRef = useRef<string>('');
  const recordingCallbacksRef = useRef<RecordingCallbacks | null>(null);
  const recordingStateRef = useRef<'idle' | 'starting' | 'recording' | 'stopping'>('idle');

  useEffect(() => {
    console.log('[Build Info] windows-video-fix=v13-dispatcher-owned-recording');
  }, []);

  const buildRecordingPath = useCallback(async (options?: RecordingCallbacks) => {
    if (options?.path) {
      const parent = String(options.path).replace(/[\\/][^\\/]+$/, '');
      if (parent && parent !== options.path) {
        await RNFS.mkdir(parent).catch(error => {
          console.log('[WindowsVideoStorage] ensureDir ok =', false);
          console.log('[WindowsVideoStorage] ensureDir error =', error);
        });
      }
      console.log('[WindowsVideoStorage] outputFile =', String(options.path));
      return String(options.path);
    }

    const outputPath = await buildWindowsRecordingOutputPath({
      webcamFolderName: options?.webcamFolderName || `windows_match_${Date.now()}`,
      segmentIndex: options?.segmentIndex,
    });

    return outputPath;
  }, []);

  const createCameraHandle = useCallback(() => ({
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
        // Native v13 schedules MediaCapture.StartRecord on the camera view dispatcher
        // and resolves after the command is queued. Give UWP a short moment to
        // actually enter recording state before gameplay can request replay/stop.
        await wait(600);
        const finalPath = String(actualPath || outputPath);

        if (finalPath !== outputPath) {
          console.log('[WindowsVideoStorage] fallbackDir =', finalPath.replace(/[\\/][^\\/]+$/, ''));
        }

        lastRecordingPathRef.current = finalPath;
        recordingStateRef.current = 'recording';
        console.log('[Recording] file created', finalPath);
        console.log('[VideoStorage] segment started', finalPath);

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
        // Native v13 returns after enqueueing stop on the camera dispatcher. Wait
        // briefly so MediaCapture finalizes the mp4 before RNFS.stat/readDir.
        await wait(1200);
        const finalPath = String(actualPath || lastRecordingPathRef.current || '');

        if (finalPath) {
          lastRecordingPathRef.current = finalPath;
          console.log('[Recording] finalized path', finalPath);
          console.log('[VideoStorage] segment stopped', finalPath);
          try {
            const exists = await RNFS.exists(finalPath);
            console.log('[WindowsVideoStorage] fileExists after record =', exists);
            if (exists) {
              const stat = await RNFS.stat(finalPath);
              console.log('[HistoryVideo] file size after stop =', Number(stat?.size || 0));
            }
          } catch (existsError) {
            console.log('[WindowsVideoStorage] fileExists after record =', false, existsError);
          }
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

  useImperativeHandle(ref, createCameraHandle, [createCameraHandle]);
  useImperativeHandle(props.cameraRef as any, createCameraHandle, [
    props.cameraRef,
    createCameraHandle,
  ]);

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
