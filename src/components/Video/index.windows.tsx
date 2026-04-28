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

type RecordingFinishedPayload = {
  path?: string;
  requestedStartAtMs?: number;
  nativeStartResolvedAtMs?: number;
  requestedStopAtMs?: number;
  nativeStopResolvedAtMs?: number;
  durationSeconds?: number;
  fileSize?: number;
};

type RecordingCallbacks = {
  onRecordingFinished?: (video: RecordingFinishedPayload) => void;
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

const normalizeWindowsPathForCompare = (path?: string | null) =>
  String(path || '').replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const waitForFinalizedFile = async (filePath: string, timeoutMs = 8000) => {
  const startedAt = Date.now();
  let exists = false;
  let fileSize = 0;
  let lastError: any = null;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      exists = await RNFS.exists(filePath);
      if (exists) {
        const stat = await RNFS.stat(filePath);
        fileSize = Number(stat?.size || 0);
        if (fileSize > 0) {
          return {exists, fileSize, waitedMs: Date.now() - startedAt};
        }
      }
    } catch (error) {
      lastError = error;
    }

    await wait(250);
  }

  return {exists, fileSize, waitedMs: Date.now() - startedAt, error: lastError};
};

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
  const recordingRequestedStartAtMsRef = useRef<number>(0);
  const recordingNativeStartResolvedAtMsRef = useRef<number>(0);
  const recordingRequestedStopAtMsRef = useRef<number>(0);

  useEffect(() => {
    console.log('[Build Info] windows-video-fix=v26-recording-segment-lifecycle-fix');
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
      console.log('[MatchSegmentRecorder]', {
        event: 'buildOutputPath',
        outputPath: String(options.path),
        segmentPath: String(options.path),
        webcamFolderName: options?.webcamFolderName,
        segmentIndex: options?.segmentIndex,
        note: 'single native MediaCapture recorder; Replay/History observe finalized segments',
      });
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
        console.log('[VideoRecorder]', {
          event: 'start',
          outputPath,
        });
        console.log('[Recording] selected camera/input source', 'WindowsNativeCameraView');
        console.log('[Recording] output path', outputPath);
        console.log('[MatchSegmentRecorder]', {
          event: 'start',
          outputPath,
          segmentPath: outputPath,
          webcamFolderName: options?.webcamFolderName,
          segmentIndex: options?.segmentIndex,
          note: 'single native MediaCapture recorder; not a separate ReplayRecorder/HistoryRecorder start',
        });

        const requestedStartAtMs = Date.now();
        recordingRequestedStartAtMsRef.current = requestedStartAtMs;
        recordingNativeStartResolvedAtMsRef.current = 0;
        console.log('[SegmentLifecycle]', {
          event: 'startRequested',
          outputPath,
          requestedStartAt: requestedStartAtMs,
          segmentIndex: options?.segmentIndex,
        });

        const actualPath = await nativeRecorder.startRecording(outputPath);
        // Native resolves only after MediaCapture has actually started recording.
        const finalPath = String(actualPath || outputPath);
        const requestedKey = normalizeWindowsPathForCompare(outputPath);
        const actualKey = normalizeWindowsPathForCompare(finalPath);

        if (actualKey !== requestedKey) {
          console.log('[WindowsVideoStorage] fallbackDir =', finalPath.replace(/[\\/][^\\/]+$/, ''));
          console.log('[HistoryRecorder]', {
            event: 'history-path-changed',
            reason: 'native recorder returned a different physical path',
            outputPath,
            actualPath: finalPath,
          });
        } else if (finalPath !== outputPath) {
          console.log('[WindowsVideoStorage] normalized native path separators', {
            outputPath,
            actualPath: finalPath,
          });
        }

        lastRecordingPathRef.current = finalPath;
        recordingStateRef.current = 'recording';
        const nativeStartResolvedAtMs = Date.now();
        recordingNativeStartResolvedAtMsRef.current = nativeStartResolvedAtMs;
        console.log('[SegmentLifecycle]', {
          event: 'nativeStartResolved',
          outputPath: finalPath,
          requestedStartAt: recordingRequestedStartAtMsRef.current,
          nativeStartResolvedAt: nativeStartResolvedAtMs,
          startupDelayMs: Math.max(0, nativeStartResolvedAtMs - recordingRequestedStartAtMsRef.current),
          segmentIndex: options?.segmentIndex,
        });
        console.log('[Recording] file created', finalPath);
        console.log('[VideoStorage] segment started', finalPath);

        return finalPath;
      } catch (error) {
        recordingStateRef.current = 'idle';
        console.log('[Recording] error', error);
        console.log('[VideoRecorder]', {
          event: 'error',
          outputPath: lastRecordingPathRef.current || undefined,
          error,
        });
        options?.onRecordingError?.(error);
        return undefined;
      }
    },
    stopRecording: async () => {
      const nativeRecorder = getWindowsCameraRecordingModule();
      const callbacks = recordingCallbacksRef.current;

      console.log('[Recording] platform=windows');
      console.log('[Recording] stop requested');
      console.log('[VideoRecorder]', {
        event: 'stop',
        outputPath: lastRecordingPathRef.current || undefined,
      });

      if (!nativeRecorder?.stopRecording) {
        const error = new Error('WindowsCameraRecordingModule.stopRecording is not available');
        console.log('[Recording] error', error.message);
        callbacks?.onRecordingError?.(error);
        recordingStateRef.current = 'idle';
        return lastRecordingPathRef.current || undefined;
      }

      try {
        recordingStateRef.current = 'stopping';
        const requestedStopAtMs = Date.now();
        recordingRequestedStopAtMsRef.current = requestedStopAtMs;
        console.log('[SegmentLifecycle]', {
          event: 'stopRequested',
          outputPath: lastRecordingPathRef.current || undefined,
          requestedStartAt: recordingRequestedStartAtMsRef.current || undefined,
          nativeStartResolvedAt: recordingNativeStartResolvedAtMsRef.current || undefined,
          requestedStopAt: requestedStopAtMs,
        });
        const actualPath = await nativeRecorder.stopRecording();
        // Native v15 resolves only after StopRecordAsync has completed.
        const finalPath = String(actualPath || lastRecordingPathRef.current || '');
        const nativeStopResolvedAtMs = Date.now();
        const nativeStartResolvedAtMs = recordingNativeStartResolvedAtMsRef.current || recordingRequestedStartAtMsRef.current || nativeStopResolvedAtMs;
        const durationMs = Math.max(0, nativeStopResolvedAtMs - nativeStartResolvedAtMs);

        if (finalPath) {
          let finalizedFileSize = 0;
          let finalizedExists = false;
          lastRecordingPathRef.current = finalPath;
          console.log('[Recording] finalized path', finalPath);
          console.log('[VideoRecorder]', {
            event: 'finalize',
            outputPath: finalPath,
          });
          console.log('[VideoStorage] segment stopped', finalPath);
          try {
            const finalized = await waitForFinalizedFile(finalPath, 8000);
            const exists = finalized.exists;
            const fileSize = finalized.fileSize;
            finalizedExists = exists;
            finalizedFileSize = fileSize;
            console.log('[SegmentLifecycle]', {
              event: 'nativeStopResolved',
              outputPath: finalPath,
              requestedStartAt: recordingRequestedStartAtMsRef.current || undefined,
              nativeStartResolvedAt: nativeStartResolvedAtMs,
              requestedStopAt: recordingRequestedStopAtMsRef.current || undefined,
              nativeStopResolvedAt: nativeStopResolvedAtMs,
              durationMs,
              fileSize,
              valid: exists && fileSize > 0 && durationMs >= 1000,
              invalidReason: !exists
                ? 'file-missing'
                : fileSize <= 0
                  ? 'file-size-zero'
                  : durationMs < 1000
                    ? 'duration-under-1000ms'
                    : undefined,
            });
            console.log('[WindowsVideoStorage] fileExists after record =', exists);
            console.log('[HistoryVideo] file size after stop =', fileSize);
            console.log('[HistoryRecorder]', {
              event: 'finalize-wait',
              outputPath: finalPath,
              fileExists: exists,
              fileSize,
              waitedMs: finalized.waitedMs,
            });
            console.log('[HistoryRecorder]', {
              event: 'stop/finalize',
              outputPath: finalPath,
              fileExists: exists,
              fileSize,
            });
            console.log('[ReplayRecorder]', {
              event: 'stop/finalize',
              outputPath: finalPath,
              segmentPath: finalPath,
              fileExists: exists,
              fileSize,
              latestReplayPath: exists && fileSize > 0 ? finalPath : undefined,
            });
            if (!exists || fileSize <= 0) {
              console.log('[ReplayRecorder]', {
                event: 'replay-not-ready',
                reason: !exists ? 'file chưa tồn tại' : 'file size = 0',
                outputPath: finalPath,
                segmentPath: finalPath,
              });
            }
          } catch (existsError) {
            console.log('[WindowsVideoStorage] fileExists after record =', false, existsError);
            console.log('[HistoryRecorder]', {
              event: 'history-not-ready',
              reason: 'path sai hoặc RNFS.stat failed',
              outputPath: finalPath,
              error: existsError,
            });
            console.log('[ReplayRecorder]', {
              event: 'replay-not-ready',
              reason: 'path sai hoặc RNFS.stat failed',
              outputPath: finalPath,
              segmentPath: finalPath,
              error: existsError,
            });
          }
          callbacks?.onRecordingFinished?.({
            path: finalPath,
            requestedStartAtMs: recordingRequestedStartAtMsRef.current || undefined,
            nativeStartResolvedAtMs,
            requestedStopAtMs: recordingRequestedStopAtMsRef.current || undefined,
            nativeStopResolvedAtMs,
            durationSeconds: durationMs / 1000,
            fileSize: finalizedFileSize || undefined,
          });
          console.log('[Replay] video discovered', finalPath);
        } else {
          const error = new Error('Windows recording stopped without a finalized path');
          console.log('[Recording] error', error.message);
          console.log('[HistoryRecorder]', {
            event: 'history-not-ready',
            reason: 'recorder chưa finalize',
          });
          console.log('[ReplayRecorder]', {
            event: 'replay-not-ready',
            reason: 'recorder chưa finalize',
          });
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
