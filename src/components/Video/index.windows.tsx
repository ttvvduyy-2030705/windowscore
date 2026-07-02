import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';
import {Image, NativeModules, Platform, StyleSheet, View} from 'react-native';
import RNFS from 'react-native-fs';
import {buildWindowsRecordingOutputPath} from 'services/replay/localReplay';
import WindowsNativeCameraView from './WindowsNativeCameraView';

type WindowsVideoSource =
  | string
  | {
      uri?: string;
      type?: string;
      rtspCandidates?: string[];
      [key: string]: any;
    };

type Props = {
  style?: any;
  source?: WindowsVideoSource;
  children?: React.ReactNode;
  overlayContent?: React.ReactNode;
  setIsCameraReady?: (isReady: boolean) => void;
  cameraScaleMode?: 'contain' | 'cover';
  cameraRef?: React.Ref<any>;
  isPaused?: boolean;
  onLoad?: (event?: any) => void;
  onError?: (event?: any) => void;
  onBuffer?: (event?: any) => void;
  onEnd?: () => void;
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

const DEBUG_WINDOWS_CAMERA = false;
const WINDOWS_RTSP_TRANSPORTS = ['tcp', 'udp'] as const;


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


const getSourceUri = (source?: WindowsVideoSource) => {
  if (typeof source === 'string') {
    return source;
  }

  if (source && typeof source === 'object' && typeof source.uri === 'string') {
    return source.uri;
  }

  return '';
};

const getRtspCandidates = (source?: WindowsVideoSource) => {
  const candidates = source && typeof source === 'object' && Array.isArray(source.rtspCandidates)
    ? source.rtspCandidates
    : [];
  const primary = getSourceUri(source);
  return [primary, ...candidates]
    .map(item => String(item || '').trim())
    .filter((item, index, list) => /^rtsp:\/\//i.test(item) && list.indexOf(item) === index);
};

const maskRtspUrlForLog = (url: string) =>
  String(url || '').replace(/rtsp:\/\/([^:]+):([^@]+)@/i, 'rtsp://$1:***@');

const getWindowsRtspPreviewModule = () => {
  const modules = NativeModules as any;
  const nativeModule = modules?.WindowsRtspPreviewModule;

  if (nativeModule?.start && nativeModule?.stop) {
    return nativeModule;
  }

  const turboModule = getTurboModule('WindowsRtspPreviewModule');
  if (turboModule?.start && turboModule?.stop) {
    return turboModule;
  }

  return null;
};

const getWindowsRtspRecorderModule = () => {
  const module = getWindowsRtspPreviewModule();
  if (module?.startRecording && module?.stopRecording) {
    return module;
  }
  return null;
};

const maskRtspErrorForLog = (value: any) =>
  String(value?.error || value?.message || value || '').replace(/rtsp:\/\/([^:]+):([^@]+)@/gi, 'rtsp://$1:***@');

const toWindowsImageFileUri = (path?: string | null) => {
  const raw = String(path || '').trim();
  if (!raw) {
    return '';
  }

  if (/^file:\/\//i.test(raw)) {
    return raw.replace(/\\/g, '/').replace(/^file:\/\/(?!\/)/i, 'file:///');
  }

  const slashPath = raw.replace(/\\/g, '/');
  const encodedPath = slashPath
    .split('/')
    .map((part, index) => {
      if (index === 0 && /^[a-zA-Z]:$/.test(part)) {
        return part;
      }
      return encodeURIComponent(part);
    })
    .join('/');

  return `file:///${encodedPath}`;
};

const makeRtspUiFramePath = (imagePath: string, frameIndex: number) => {
  const baseDir = String(imagePath || '').replace(/[\\/][^\\/]+$/, '');
  const separator = imagePath.includes('\\') ? '\\' : '/';
  return `${baseDir}${separator}rtsp-preview-ui-${frameIndex % 2}.jpg`;
};

const makeRtspRecordingPath = (outputPath: string) => {
  const raw = String(outputPath || '').trim();
  if (!raw) {
    return raw;
  }

  // v33: RTSP Replay/History is finalized as real MP4 in Videos/Aplus Score.
  // Do not silently switch to .ts because ReplayTemp/history scanners and users
  // expect a playable .mp4 file.
  if (/\.mp4$/i.test(raw)) {
    return raw;
  }
  if (/\.[a-z0-9]+$/i.test(raw)) {
    return raw.replace(/\.[a-z0-9]+$/i, '.mp4');
  }
  return `${raw}.mp4`;
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
  const propsRef = useRef(props);
  const sourceUri = getSourceUri(props.source);
  const sourceRtspCandidatesKey =
    props.source &&
    typeof props.source === 'object' &&
    Array.isArray(props.source.rtspCandidates)
      ? props.source.rtspCandidates.map(item => String(item || '').trim()).filter(Boolean).join('|')
      : '';
  const rtspSourceKey = `${sourceUri}|${sourceRtspCandidatesKey}`;
  const rtspCandidates = useMemo(() => getRtspCandidates(props.source), [rtspSourceKey]);
  const rtspCandidatesKey = useMemo(() => rtspCandidates.join('|'), [rtspCandidates]);
  const rtspCandidatesRef = useRef<string[]>(rtspCandidates);
  const [rtspCandidateIndex, setRtspCandidateIndex] = useState(0);
  const [rtspTransportIndex, setRtspTransportIndex] = useState(0);
  const [rtspFrameUri, setRtspFrameUri] = useState('');
  const [rtspPendingFrameUri, setRtspPendingFrameUri] = useState('');
  const [rtspStatus, setRtspStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [rtspErrorText, setRtspErrorText] = useState('');
  const activeRtspUrl = rtspCandidates[Math.min(rtspCandidateIndex, Math.max(0, rtspCandidates.length - 1))] || '';
  const activeRtspTransport = WINDOWS_RTSP_TRANSPORTS[rtspTransportIndex] || 'tcp';
  const rtspAttemptRef = useRef(0);
  const rtspFrameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rtspRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rtspUiFrameCounterRef = useRef(0);
  const rtspLastSourceFrameSignatureRef = useRef('');
  const rtspLastFrameLogRef = useRef(0);
  const rtspPendingFrameLoadRef = useRef('');
  const isRtspSource = !!activeRtspUrl;

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  useEffect(() => {
    rtspCandidatesRef.current = rtspCandidates;
  }, [rtspCandidates]);

  useEffect(() => {
    rtspAttemptRef.current = 0;
    setRtspCandidateIndex(0);
    setRtspTransportIndex(0);
  }, [rtspCandidatesKey]);

  const stopRtspPreview = useCallback(() => {
    if (rtspFrameTimerRef.current) {
      clearInterval(rtspFrameTimerRef.current);
      rtspFrameTimerRef.current = null;
    }
    if (rtspRestartTimerRef.current) {
      clearTimeout(rtspRestartTimerRef.current);
      rtspRestartTimerRef.current = null;
    }
    const nativeRtspPreview = getWindowsRtspPreviewModule();
    nativeRtspPreview?.stop?.().catch?.((error: any) => {
      console.log('[IPCamera] rtsp-preview-stop-error', maskRtspErrorForLog(error));
    });
  }, []);

  useEffect(() => {
    if (!isRtspSource) {
      setRtspFrameUri('');
      setRtspPendingFrameUri('');
      setRtspStatus('idle');
      setRtspErrorText('');
      return undefined;
    }

    let cancelled = false;
    let loadEmitted = false;
    const nativeRtspPreview = getWindowsRtspPreviewModule();

    setRtspPendingFrameUri('');
    rtspLastSourceFrameSignatureRef.current = '';
    setRtspStatus(prev => (rtspFrameUri ? prev : 'loading'));
    setRtspErrorText('');
    setIsCameraReady?.(false);

    console.log('[IPCamera] windows RTSP ffmpeg-preview source', {
      url: maskRtspUrlForLog(activeRtspUrl),
      candidateIndex: rtspCandidateIndex,
      candidateCount: rtspCandidates.length,
      transport: activeRtspTransport,
    });

    if (!nativeRtspPreview?.start) {
      const error = 'WindowsRtspPreviewModule.start is not available';
      console.log('[IPCamera] rtsp-preview-error', {error});
      setRtspStatus('error');
      setRtspErrorText(error);
      setIsCameraReady?.(false);
      propsRef.current.onError?.({error});
      return undefined;
    }

    const readFrame = async (imagePath: string) => {
      try {
        const exists = await RNFS.exists(imagePath);
        if (!exists || cancelled) {
          return;
        }

        const stat = await RNFS.stat(imagePath);
        const fileSize = Number(stat?.size || 0);
        const mtime = Number(new Date((stat as any)?.mtime || 0).getTime() || 0);
        if (fileSize <= 0 || cancelled) {
          return;
        }

        const sourceSignature = `${fileSize}:${mtime}`;
        if (sourceSignature === rtspLastSourceFrameSignatureRef.current) {
          return;
        }
        rtspLastSourceFrameSignatureRef.current = sourceSignature;

        // React Native Windows Image flashes if the visible Image source is
        // swapped before the new file has decoded. Copy the latest ffmpeg frame
        // to an alternating file name, load it in an invisible Image first, and
        // only then swap the visible frame. This keeps the old frame on screen
        // whenever the stream stalls for a few ticks.
        const nextFrameIndex = rtspUiFrameCounterRef.current + 1;
        rtspUiFrameCounterRef.current = nextFrameIndex;
        const uiFramePath = makeRtspUiFramePath(imagePath, nextFrameIndex);
        await RNFS.copyFile(imagePath, uiFramePath);

        if (cancelled) {
          return;
        }

        const frameUri = toWindowsImageFileUri(uiFramePath);
        if (rtspPendingFrameLoadRef.current && rtspPendingFrameLoadRef.current !== frameUri) {
          return;
        }
        rtspPendingFrameLoadRef.current = frameUri;
        setRtspPendingFrameUri(prev => (prev === frameUri ? prev : frameUri));

        const now = Date.now();
        if (!rtspLastFrameLogRef.current || now - rtspLastFrameLogRef.current > 3000) {
          rtspLastFrameLogRef.current = now;
          console.log('[IPCamera] rtsp-frame-ready-for-swap', {
            imagePath: uiFramePath,
            imageUri: frameUri,
            fileSize,
            backend: 'ffmpeg-frame-preview',
          });
        }

        if (!loadEmitted) {
          loadEmitted = true;
          console.log('[IPCamera] rtsp-open-success', {
            url: maskRtspUrlForLog(activeRtspUrl),
            candidateIndex: rtspCandidateIndex,
            backend: 'ffmpeg-frame-preview',
            transport: activeRtspTransport,
          });
          propsRef.current.onLoad?.({duration: 1, source: 'ffmpeg-frame-preview'});
        }
      } catch (error) {
        if (!cancelled) {
          console.log('[IPCamera] rtsp-frame-read-error', maskRtspErrorForLog(error));
        }
      }
    };

    nativeRtspPreview
      .start({url: activeRtspUrl, transport: activeRtspTransport, fps: 4, timeoutMs: 16000})
      .then(async (result: any) => {
        if (cancelled) {
          return;
        }
        if (result?.status !== 'preview' || !result?.imagePath) {
          throw new Error(result?.error || 'RTSP preview failed before first frame');
        }

        console.log('[IPCamera] rtsp-preview-started', {
          url: maskRtspUrlForLog(activeRtspUrl),
          imagePath: result.imagePath,
          ffmpegPath: result.ffmpegPath,
          stderrSummary: result.stderrSummary,
          transport: activeRtspTransport,
        });

        await readFrame(String(result.imagePath));
        if (!cancelled) {
          rtspFrameTimerRef.current = setInterval(() => {
            readFrame(String(result.imagePath));
          }, 500);
        }
      })
      .catch((error: any) => {
        if (cancelled) {
          return;
        }
        const message = maskRtspErrorForLog(error);
        console.log('[IPCamera] rtsp-error', {
          url: maskRtspUrlForLog(activeRtspUrl),
          candidateIndex: rtspCandidateIndex,
          candidateCount: rtspCandidates.length,
          error: message,
        });
        setRtspStatus('error');
        setRtspErrorText(message || 'Không mở được RTSP camera');
        setIsCameraReady?.(false);

        const currentCandidates = rtspCandidatesRef.current.length ? rtspCandidatesRef.current : rtspCandidates;
        const totalAttempts = Math.max(1, currentCandidates.length * WINDOWS_RTSP_TRANSPORTS.length);
        const nextAttempt = rtspAttemptRef.current + 1;

        if (nextAttempt < totalAttempts) {
          rtspAttemptRef.current = nextAttempt;
          const nextCandidateIndex = Math.floor(nextAttempt / WINDOWS_RTSP_TRANSPORTS.length);
          const nextTransportIndex = nextAttempt % WINDOWS_RTSP_TRANSPORTS.length;
          rtspRestartTimerRef.current = setTimeout(() => {
            console.log('[IPCamera] rtsp-timeout-reconnect', {
              fromCandidate: rtspCandidateIndex,
              fromTransport: activeRtspTransport,
              toCandidate: nextCandidateIndex,
              toTransport: WINDOWS_RTSP_TRANSPORTS[nextTransportIndex],
              nextUrl: maskRtspUrlForLog(currentCandidates[nextCandidateIndex]),
              backend: 'ffmpeg-frame-preview',
            });
            setRtspCandidateIndex(nextCandidateIndex);
            setRtspTransportIndex(nextTransportIndex);
          }, 900);
        } else {
          console.log('[IPCamera] rtsp-all-candidates-failed', {
            candidateCount: currentCandidates.length,
            transportCount: WINDOWS_RTSP_TRANSPORTS.length,
            lastError: message,
          });
          propsRef.current.onError?.({error: message || 'RTSP preview failed'});
        }
      });

    return () => {
      cancelled = true;
      stopRtspPreview();
    };
  }, [activeRtspTransport, activeRtspUrl, isRtspSource, rtspCandidateIndex, rtspCandidatesKey, rtspTransportIndex, setIsCameraReady, stopRtspPreview]);
  const lastRecordingPathRef = useRef<string>('');
  const recordingCallbacksRef = useRef<RecordingCallbacks | null>(null);
  const recordingStateRef = useRef<'idle' | 'starting' | 'recording' | 'stopping'>('idle');
  const recordingRequestedStartAtMsRef = useRef<number>(0);
  const recordingNativeStartResolvedAtMsRef = useRef<number>(0);
  const recordingRequestedStopAtMsRef = useRef<number>(0);

  useEffect(() => {
    console.log('[Build Info] windows-video-fix=v34-background-safe-recording');
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
      const rtspRecorder = isRtspSource ? getWindowsRtspRecorderModule() : null;
      const nativeRecorder = rtspRecorder || getWindowsCameraRecordingModule();
      const recorderBackend = rtspRecorder ? 'windows-rtsp-ffmpeg' : 'windows-native';

      if (!nativeRecorder?.startRecording) {
        const error = new Error(rtspRecorder
          ? 'WindowsRtspPreviewModule.startRecording is not available'
          : 'WindowsCameraRecordingModule.startRecording is not available');
        console.log('[Recording] error', error.message);
        options?.onRecordingError?.(error);
        return undefined;
      }

      try {
        recordingStateRef.current = 'starting';
        recordingCallbacksRef.current = options || null;

        const outputPath = await buildRecordingPath(options);
        const recordingOutputPath = rtspRecorder ? makeRtspRecordingPath(outputPath) : outputPath;
        lastRecordingPathRef.current = recordingOutputPath;

        console.log('[Recording] platform=windows');
        console.log('[Recording] start requested');
        console.log('[VideoRecorder]', {
          event: 'start',
          outputPath: recordingOutputPath,
        });
        console.log('[Recording] selected camera/input source', recorderBackend);
        console.log('[Recording] output path', recordingOutputPath);
        console.log('[MatchSegmentRecorder]', {
          event: 'start',
          outputPath: recordingOutputPath,
          segmentPath: recordingOutputPath,
          webcamFolderName: options?.webcamFolderName,
          segmentIndex: options?.segmentIndex,
          note: rtspRecorder ? 'single RTSP FFmpeg MP4 recorder; Replay/History consume finalized MP4 segment' : 'single native MediaCapture recorder; not a separate ReplayRecorder/HistoryRecorder start',
        });

        const requestedStartAtMs = Date.now();
        recordingRequestedStartAtMsRef.current = requestedStartAtMs;
        recordingNativeStartResolvedAtMsRef.current = 0;
        console.log('[SegmentLifecycle]', {
          event: 'startRequested',
          outputPath: recordingOutputPath,
          requestedStartAt: requestedStartAtMs,
          segmentIndex: options?.segmentIndex,
        });

        const actualPath = rtspRecorder
          ? await nativeRecorder.startRecording({
              url: activeRtspUrl,
              transport: activeRtspTransport,
              outputPath: recordingOutputPath,
            })
          : await nativeRecorder.startRecording(recordingOutputPath);
        if (actualPath && typeof actualPath === 'object' && actualPath.status === 'error') {
          throw new Error(String(actualPath.error || 'RTSP FFmpeg recorder failed to start'));
        }
        // Native resolves only after recording has actually started.
        const finalPath = String((actualPath && (actualPath.path || actualPath.outputPath || actualPath)) || recordingOutputPath);
        const requestedKey = normalizeWindowsPathForCompare(recordingOutputPath);
        const actualKey = normalizeWindowsPathForCompare(finalPath);

        if (actualKey !== requestedKey) {
          console.log('[WindowsVideoStorage] fallbackDir =', finalPath.replace(/[\\/][^\\/]+$/, ''));
          console.log('[HistoryRecorder]', {
            event: 'history-path-changed',
            reason: 'native recorder returned a different physical path',
            outputPath: recordingOutputPath,
            actualPath: finalPath,
          });
        } else if (finalPath !== outputPath) {
          console.log('[WindowsVideoStorage] normalized native path separators', {
            outputPath: recordingOutputPath,
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
        if (rtspRecorder) {
          console.log('[RtspReplayRecorder]', {
            event: 'start-success',
            url: maskRtspUrlForLog(activeRtspUrl),
            transport: activeRtspTransport,
            outputPath: finalPath,
            backend: 'ffmpeg-rtsp-mp4',
          });
        }
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
      const rtspRecorder = isRtspSource ? getWindowsRtspRecorderModule() : null;
      const nativeRecorder = rtspRecorder || getWindowsCameraRecordingModule();
      const callbacks = recordingCallbacksRef.current;

      console.log('[Recording] platform=windows');
      console.log('[Recording] stop requested');
      console.log('[VideoRecorder]', {
        event: 'stop',
        outputPath: lastRecordingPathRef.current || undefined,
      });

      if (!nativeRecorder?.stopRecording) {
        const error = new Error(rtspRecorder
          ? 'WindowsRtspPreviewModule.stopRecording is not available'
          : 'WindowsCameraRecordingModule.stopRecording is not available');
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
        const nativeResult = actualPath && typeof actualPath === 'object' ? actualPath : null;
        if (rtspRecorder && nativeResult?.status === 'error') {
          const error = new Error(String(nativeResult.error || 'RTSP FFmpeg recorder failed to finalize MP4'));
          console.log('[RtspReplayRecorder]', {
            event: 'record-failed',
            outputPath: nativeResult.outputPath || nativeResult.path || lastRecordingPathRef.current || undefined,
            fileExists: Boolean(nativeResult.fileExists),
            fileSize: Number(nativeResult.fileSize || 0),
            durationSeconds: Number(nativeResult.durationSeconds || 0),
            exitCode: nativeResult.exitCode,
            stderrSummary: nativeResult.stderrSummary,
            command: nativeResult.command,
            error: error.message,
          });
          callbacks?.onRecordingError?.(error);
          recordingCallbacksRef.current = null;
          recordingStateRef.current = 'idle';
          return undefined;
        }
        // Native resolves only after the recorder process has been stopped.
        const finalPath = String((nativeResult && (nativeResult.path || nativeResult.outputPath)) || actualPath || lastRecordingPathRef.current || '');
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
            const finalized = await waitForFinalizedFile(finalPath, rtspRecorder ? 15000 : 8000);
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
          if (!finalizedExists || finalizedFileSize <= 0) {
            const error = new Error('Windows RTSP recording did not create a playable MP4 file');
            console.log('[RtspReplayRecorder]', {
              event: 'record-failed',
              outputPath: finalPath,
              fileExists: finalizedExists,
              fileSize: finalizedFileSize,
              durationSeconds: durationMs / 1000,
              reason: !finalizedExists ? 'file-missing' : 'file-size-zero',
            });
            callbacks?.onRecordingError?.(error);
            recordingCallbacksRef.current = null;
            recordingStateRef.current = 'idle';
            return undefined;
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
          if (rtspRecorder) {
            console.log('[RtspReplayRecorder]', {
              event: 'stop-success',
              outputPath: finalPath,
              fileSize: finalizedFileSize,
              durationSeconds: durationMs / 1000,
              backend: 'ffmpeg-rtsp-mp4',
            });
          }
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
    isWindowsRtspSource: () => isRtspSource,
    isWindowsRtspRecordingSource: () => isRtspSource,
    getRecordingInfo: () => ({
      state: recordingStateRef.current,
      activeBackend: isRtspSource ? 'windows-rtsp-ffmpeg' : 'windows-native',
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
  }), [activeRtspTransport, activeRtspUrl, buildRecordingPath, isRtspSource]);

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
      fallback: 'rtsp uses ffmpeg-frame-preview; no-camera/error shows APlus fallback logo',
    });

    setIsCameraReady?.(true);
  }, [setIsCameraReady]);

  if (isRtspSource) {
    const showRtspFrame = !!rtspFrameUri;
    const pendingFrameVisible = !!rtspPendingFrameUri && rtspPendingFrameUri !== rtspFrameUri;
    const commitPendingFrame = (frameUri: string) => {
      if (!frameUri) {
        return;
      }
      rtspPendingFrameLoadRef.current = '';
      setRtspFrameUri(prev => (prev === frameUri ? prev : frameUri));
      setRtspPendingFrameUri(prev => (prev === frameUri ? '' : prev));
      setRtspStatus('ready');
      setRtspErrorText('');
      setIsCameraReady?.(true);
      const now = Date.now();
      if (!rtspLastFrameLogRef.current || now - rtspLastFrameLogRef.current > 3000) {
        rtspLastFrameLogRef.current = now;
        console.log('[IPCamera] rtsp-frame-visible', {
          imageUri: frameUri,
          backend: 'ffmpeg-frame-preview',
          swapMode: 'preload-double-buffer',
        });
      }
    };

    return (
      <View style={[styles.container, props.style]}>
        {showRtspFrame ? (
          <Image
            source={{uri: rtspFrameUri}}
            style={StyleSheet.absoluteFill}
            resizeMode={props.cameraScaleMode === 'contain' ? 'contain' : 'cover'}
          />
        ) : (
          <View style={styles.fallbackBox}>
            <Image source={require('../../assets/images/logo-small.png')} style={styles.fallbackLogo} resizeMode={'contain'} />
            {rtspStatus === 'loading' ? (
              <View style={styles.fallbackDot} />
            ) : null}
          </View>
        )}
        {pendingFrameVisible ? (
          <Image
            key={rtspPendingFrameUri}
            source={{uri: rtspPendingFrameUri}}
            style={styles.preloadFrame}
            resizeMode={props.cameraScaleMode === 'contain' ? 'contain' : 'cover'}
            onLoad={() => commitPendingFrame(rtspPendingFrameUri)}
            onError={error => {
              console.log('[IPCamera] rtsp-frame-preload-error', {
                imageUri: rtspPendingFrameUri,
                error: maskRtspErrorForLog(error),
              });
              rtspPendingFrameLoadRef.current = '';
              setRtspPendingFrameUri(prev => (prev === rtspPendingFrameUri ? '' : prev));
            }}
          />
        ) : null}
        {props.children}
        {props.overlayContent}
      </View>
    );
  }

  return (
    <View style={[styles.container, props.style]}>
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
  preloadFrame: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.01,
  },
  fallbackBox: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  fallbackLogo: {
    width: '56%',
    height: '30%',
    opacity: 0.95,
  },
  fallbackDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#23D447',
    marginTop: 10,
  },
});

export default VideoWindows;
