import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {RootState} from 'data/redux/reducers';
import {useSelector} from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import {keys} from 'configuration/keys';
import {
  WEBCAM_BASE_FILE_NAME,
  WEBCAM_FILE_EXTENSION,
  WEBCAM_HOST,
  WEBCAM_PATH,
  WEBCAM_PORT,
} from 'constants/webcam';
import {
  OnBufferData,
  OnLoadData,
  OnSeekData,
  OnVideoErrorData,
  OnVideoTracksData,
} from 'react-native-video';
import {streamWebcamToFile} from 'services/ffmpeg/local';
import {liveStreamFromCamera} from 'services/ffmpeg/livestream';
import {requestReadWriteStorage} from 'utils/permission';
import {navigate} from 'utils/navigation';
import {screens} from 'scenes/screens';
import {
  Bitrate,
  Fps,
  LiveStreamCamera,
  OutputType,
  Resolution,
  Webcam,
  WebcamType,
} from 'types/webcam';
import {CAMERA_PLAYBACK_DURATION} from './constants';
import {PlayBackWebcamViewModelProps} from 'scenes/playback/PlayBackViewModel';
import {emitCycleCameraSource} from 'utils/cameraSourceSwitcher';
import {GameSettings} from 'types/settings';

export interface Props {
  innerControls?: boolean;
  webcamFolderName?: string;
  updateWebcamFolderName: (name: string) => void;
  cameraRef?: any;
  isStarted: boolean;
  isPaused: boolean;
  videoUri?: string;
  setVideoUri?: (name: string) => void;
  isCameraReady: boolean;
  setIsCameraReady: (isReady: boolean) => void;
  youtubeLivePreviewActive?: boolean;
  gameSettings?: GameSettings;
}

type CameraSource = 'back' | 'front' | 'external';

const DEBUG_WEBCAM = false;
const debugWebcamLog = (...args: any[]) => {
  if (__DEV__ && DEBUG_WEBCAM) {
    console.log(...args);
  }
};


let interval: NodeJS.Timeout, cameraInterval: NodeJS.Timeout;

const CAMERA_SOURCE_CYCLE: CameraSource[] = ['back', 'front', 'external'];

const hasDetectedUvcSource = (): boolean => {
  return (globalThis as any).__APLUS_UVC_PRESENT__ === true;
};

const getCurrentCameraSourceSnapshot = (): CameraSource => {
  const value = (globalThis as any).__APLUS_CURRENT_CAMERA_SOURCE__;
  if (value === 'front' || value === 'external') {
    return value;
  }
  return 'back';
};

const setCurrentCameraSourceSnapshot = (source: CameraSource) => {
  (globalThis as any).__APLUS_CURRENT_CAMERA_SOURCE__ = source;
};

const getAvailableCameraSources = (): CameraSource[] => {
  const rawSources = (globalThis as any).__APLUS_AVAILABLE_CAMERA_SOURCES__;
  const hasUvc = hasDetectedUvcSource();

  const normalized = Array.isArray(rawSources)
    ? Array.from(
        new Set(
          rawSources.filter(
            (item: any): item is CameraSource =>
              item === 'back' || item === 'front' || item === 'external',
          ),
        ),
      )
    : [];

  const filtered = normalized.filter(source => {
    if (source === 'external') {
      return hasUvc;
    }
    return true;
  });

  if (filtered.length) {
    return filtered;
  }

  return hasUvc ? ['back', 'front', 'external'] : ['back', 'front'];
};

const getNextCameraSource = (
  current: CameraSource,
  available: CameraSource[],
): CameraSource => {
  const validCycle = CAMERA_SOURCE_CYCLE.filter(item =>
    available.includes(item),
  );

  if (!validCycle.length) {
    return 'back';
  }

  const currentIndex = validCycle.indexOf(current);
  if (currentIndex === -1) {
    return validCycle[0];
  }

  return validCycle[(currentIndex + 1) % validCycle.length];
};

const sourceToWebcamType = (source: CameraSource): WebcamType => {
  return source === 'external' ? WebcamType.webcam : WebcamType.camera;
};

type RecordingInfo = {
  state?: 'idle' | 'starting' | 'recording' | 'stopping';
  activeBackend?: 'vision' | 'uvc' | 'youtube-native' | null;
  source?: 'back' | 'front' | 'external';
  isRecording?: boolean;
};

const getCameraRecordingInfo = (cameraRef: any): RecordingInfo => {
  const fromRef = cameraRef?.current?.getRecordingInfo?.();
  if (fromRef) {
    return fromRef;
  }

  return (globalThis as any).__APLUS_CAMERA_RECORDING_SNAPSHOT__ || {
    state: 'idle',
    activeBackend: null,
    source: 'back',
    isRecording: false,
  };
};

const WebCamViewModel = (props: Props) => {
  const videoRef = useRef(null);
  const {gameSettings: reduxGameSettings} = useSelector((state: RootState) => state.game);
  const gameSettings = reduxGameSettings ?? props.gameSettings;

  const [webcamType, setWebcamType] = useState(WebcamType.camera);
  const [webcam, setWebcam] = useState<Webcam | undefined>();
  const [liveStream, setLiveStream] = useState<LiveStreamCamera | undefined>();
  const [connectCountdownTime, setConnectCountdownTime] = useState(10);
  const [autoConnect, setAutoConnect] = useState(false);
  const [isWebcamStarted, setIsWebcamStarted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [innerControlsShow, setInnerControlsShow] = useState(false);
  const [url, setUrl] = useState<string | undefined>();
  const [currentSeekPosition, setCurrentSeekPosition] = useState(0);

  const clearPlaybackTimers = useCallback(() => {
    clearInterval(cameraInterval);
    clearInterval(interval);
  }, []);

  const resetConnectionState = useCallback(() => {
    clearPlaybackTimers();
    setUrl(undefined);
    setAutoConnect(false);
    setIsWebcamStarted(false);
    setConnectCountdownTime(10);
  }, [clearPlaybackTimers]);

  const getCameraData = useCallback(() => {
    AsyncStorage.multiGet(
      [
        keys.CAMERA_RTMP_URL,
        keys.CAMERA_STREAM_KEY,
        keys.OUTPUT_TYPE,
        keys.CAMERA_RESOLUTION,
        keys.CAMERA_FPS,
        keys.CAMERA_BITRATE,
      ],
      (error, result) => {
        if (error || !result) {
          return;
        }

        const rtmpUrl = result[0][1];
        const streamKey = result[1][1];
        const outputType = result[2][1];
        const resolution = result[3][1];
        const fps = result[4][1];
        const bitrate = result[5][1];

        setLiveStream({
          rtmpUrl: rtmpUrl || '',
          streamKey: streamKey || '',
          outputType: (outputType || OutputType.local) as OutputType,
          resolution: (resolution || Resolution.FullHD) as Resolution,
          fps: (fps || Fps.F30) as Fps,
          bitrate: (bitrate || Bitrate.B9000) as Bitrate,
        });

        interval = setInterval(() => {
          setConnectCountdownTime(prev => (prev - 1 > 0 ? prev - 1 : 0));
        }, 1000);
      },
    );
  }, []);

  const getWebcamData = useCallback(() => {
    if (!hasDetectedUvcSource()) {
      getCameraData();
      setWebcamType(WebcamType.camera);
      return;
    }

    AsyncStorage.multiGet(
      [
        keys.WEBCAM_IP_ADDRESS,
        keys.WEBCAM_USERNAME,
        keys.WEBCAM_PASSWORD,
        keys.WEBCAM_SCALE,
        keys.WEBCAM_SYNC_TIME,
        keys.WEBCAM_TRANSLATE_X,
        keys.WEBCAM_TRANSLATE_Y,
        keys.OUTPUT_TYPE,
        keys.CAMERA_RTMP_URL,
        keys.CAMERA_STREAM_KEY,
        keys.CAMERA_RESOLUTION,
        keys.CAMERA_FPS,
        keys.CAMERA_BITRATE,
      ],
      (error, result) => {
        if (error || !result) {
          getCameraData();
          setWebcamType(WebcamType.camera);
          return;
        }

        const ip = result[0][1];
        const username = result[1][1];
        const password = result[2][1];
        const scale = result[3][1];
        const syncTime = result[4][1];
        const translateX = result[5][1];
        const translateY = result[6][1];
        const outputType = result[7][1];
        const rtmpUrl = result[8][1];
        const streamKey = result[9][1];
        const resolution = result[10][1];
        const fps = result[11][1];
        const bitrate = result[12][1];

        if (!ip || !username || !password) {
          getCameraData();
          setWebcamType(WebcamType.camera);
          return;
        }

        setWebcam({
          webcamIP: ip,
          username,
          password,
          scale: scale ? Number(scale) : 1,
          syncTime: syncTime ? Number(syncTime) : 60,
          translateX: translateX ? Number(translateX) : 0,
          translateY: translateY ? Number(translateY) : 0,
          outputType: (outputType || OutputType.local) as OutputType,
        });

        setLiveStream({
          rtmpUrl: rtmpUrl || '',
          streamKey: streamKey || '',
          outputType: (outputType || OutputType.local) as OutputType,
          resolution: (resolution || Resolution.FullHD) as Resolution,
          fps: (fps || Fps.F30) as Fps,
          bitrate: (bitrate || Bitrate.B9000) as Bitrate,
        });

        interval = setInterval(() => {
          setConnectCountdownTime(prev => (prev - 1 > 0 ? prev - 1 : 0));
        }, 1000);
      },
    );
  }, [getCameraData]);

  useEffect(() => {
    const preservedSource = getCurrentCameraSourceSnapshot();
    setCurrentCameraSourceSnapshot(preservedSource);

    resetConnectionState();
    setWebcam(undefined);
    setWebcamType(WebcamType.camera);

    AsyncStorage.setItem(keys.WEBCAM_TYPE, WebcamType.camera).catch(() => {});

    getCameraData();

    return () => {
      clearPlaybackTimers();
    };
  }, [clearPlaybackTimers, getCameraData, resetConnectionState]);

  useEffect(() => {
    const _countdownTime = (webcam?.syncTime || CAMERA_PLAYBACK_DURATION) * 2;
    const canConnect =
      _countdownTime > 10 ? true : _countdownTime - connectCountdownTime >= 0;

    if (!canConnect) {
      return;
    }

    setAutoConnect(true);

    if (connectCountdownTime === 0) {
      clearInterval(interval);
    }
  }, [webcam, connectCountdownTime]);

  useEffect(() => {
    if (!autoConnect || isWebcamStarted) {
      return;
    }

    requestReadWriteStorage().then(async isGranted => {
      if (!isGranted) {
        return;
      }

      setIsWebcamStarted(true);

      const outputType =
        webcamType === WebcamType.camera
          ? liveStream?.outputType
          : webcam?.outputType;

      const sourceUrl =
        webcamType === WebcamType.webcam && webcam
          ? `${WEBCAM_HOST}${webcam.username}:${webcam.password}@${webcam.webcamIP}:${WEBCAM_PORT}${WEBCAM_PATH}`
          : undefined;

      if (outputType === OutputType.livestream) {
        liveStreamFromCamera(
          liveStream,
          sourceUrl,
          webcamType,
          !!gameSettings?.mode.countdownTime,
          gameSettings?.category,
        );
        return;
      }

      const now = Date.now().toString();

      streamWebcamToFile(
        now,
        webcam?.syncTime || CAMERA_PLAYBACK_DURATION,
        webcamType,
        sourceUrl,
      );

      if (webcamType === WebcamType.camera && outputType === OutputType.local) {
        await new Promise(resolve => {
          const timeout = setTimeout(() => {
            resolve(true);
            clearTimeout(timeout);
          }, CAMERA_PLAYBACK_DURATION * 1000);
        });

        let i = -1;
        cameraInterval = setInterval(() => {
          i++;
          const newCameraUrl = `${RNFS.DownloadDirectoryPath}/${now}/${WEBCAM_BASE_FILE_NAME}${
            i < 10 ? `0${i}` : i
          }${WEBCAM_FILE_EXTENSION}`;
          setUrl(newCameraUrl);
        }, CAMERA_PLAYBACK_DURATION * 1000 + 100);
      } else {
        setUrl(sourceUrl);
      }
    });
  }, [
    webcamType,
    webcam,
    liveStream,
    autoConnect,
    isWebcamStarted,
    gameSettings,
  ]);

  const recordingInfo = getCameraRecordingInfo(props.cameraRef);
  const currentCameraSource =
    recordingInfo?.source ||
    props.cameraRef?.current?.getZoomInfo?.()?.source ||
    (globalThis as any).__APLUS_CURRENT_CAMERA_SOURCE__ ||
    'unknown';

  const explicitRecordingState =
    recordingInfo?.isRecording === true ||
    recordingInfo?.state === 'starting' ||
    recordingInfo?.state === 'recording';

  const isVideoSessionLocked =
    explicitRecordingState || props.youtubeLivePreviewActive === true;

  debugWebcamLog('[WebCam] session lock state:', {
    currentSource: currentCameraSource,
    explicitRecordingState,
    isVideoSessionLocked,
    refreshing,
    youtubeLivePreviewActive: props.youtubeLivePreviewActive === true,
  });

  const blockCrossBackendActions = isVideoSessionLocked;

  const onRefresh = useCallback(() => {
    if (blockCrossBackendActions) {
      debugWebcamLog(
        '[WebCam] refresh blocked: external webcam is recording, cannot switch backend',
      );
      return;
    }

    props.setIsCameraReady(false);
    setRefreshing(true);

    const timeout = setTimeout(() => {
      setRefreshing(false);
      clearTimeout(timeout);
    }, 1000);
  }, [props, blockCrossBackendActions]);

  const onSwitchCamera = useCallback(async () => {
    if (blockCrossBackendActions) {
      debugWebcamLog(
        '[WebCam] switch camera blocked: external webcam is recording',
      );
      return;
    }

    // Chỉ cycle source trong backend camera hiện tại: back -> front -> external -> back.
    // Không đổi sang WebcamType.webcam, vì external USB webcam đã được Video/index.tsx xử lý
    // ngay trong backend camera.
    if (webcamType === WebcamType.camera) {
      const currentSource = getCurrentCameraSourceSnapshot();
      const availableSources = getAvailableCameraSources();
      const nextSource = getNextCameraSource(currentSource, availableSources);

      debugWebcamLog('[WebCam] cycle source request:', {
        currentSource,
        availableSources,
        nextSource,
        hasUvc: hasDetectedUvcSource(),
      });

      setCurrentCameraSourceSnapshot(nextSource);
      props.setIsCameraReady(false);
      setRefreshing(true);
      emitCycleCameraSource();

      const timeout = setTimeout(() => {
        setRefreshing(false);
        clearTimeout(timeout);
      }, 350);
      return;
    }

    // Fallback cho các mode webcam cũ
    props.setIsCameraReady(false);
    setRefreshing(true);
    resetConnectionState();
    setWebcam(undefined);
    setWebcamType(WebcamType.camera);
    setCurrentCameraSourceSnapshot('back');

    try {
      await AsyncStorage.setItem(keys.WEBCAM_TYPE, WebcamType.camera);
    } catch {}

    getCameraData();

    const timeout = setTimeout(() => {
      setRefreshing(false);
      clearTimeout(timeout);
    }, 350);
  }, [
    blockCrossBackendActions,
    webcamType,
    props,
    resetConnectionState,
    getCameraData,
  ]);

  const onDelay = useCallback(() => {}, []);

  const onReWatch = useCallback(() => {
    navigate(screens.playback, {
      webcamFolderName: props.webcamFolderName,
      merged: false,
    } as PlayBackWebcamViewModelProps);
  }, [props.webcamFolderName]);

  const onFullscreenPlayerDidPresent = useCallback(() => {}, []);
  const onBuffer = useCallback((_data: OnBufferData) => {}, []);
  const onSeek = useCallback((_data: OnSeekData) => {}, []);
  const onLoad = useCallback((_data: OnLoadData) => {}, []);
  const onVideoTracks = useCallback((_data: OnVideoTracksData) => {}, []);
  const onEnd = useCallback(() => {}, []);

  const onWebcamError = useCallback(
    (e: OnVideoErrorData) => {
      console.error('On webcam error', e);

      if (webcamType === WebcamType.camera) {
        setCurrentSeekPosition(prev => prev + CAMERA_PLAYBACK_DURATION);
      }
    },
    [webcamType],
  );

  const onToggleInnerControls = useCallback(() => {
    if (!props.innerControls) {
      return;
    }

    setInnerControlsShow(prev => !prev);
  }, [props.innerControls]);

  return useMemo(
    () => ({
      videoRef,
      innerControlsShow,
      refreshing,
      autoConnect,
      webcamType,
      webcam,
      liveStream,
      connectCountdownTime,
      source:
        webcamType === WebcamType.webcam
          ? {uri: url, type: 'rtsp'}
          : {uri: url, type: 'mov'},
      onRefresh,
      onSwitchCamera,
      onDelay,
      onReWatch,
      onFullscreenPlayerDidPresent,
      onBuffer,
      onSeek,
      onLoad,
      onVideoTracks,
      onEnd,
      onWebcamError,
      onToggleInnerControls,
      canRefresh: !blockCrossBackendActions && !refreshing,
      canSwitchCamera: !blockCrossBackendActions && !refreshing,
      currentSeekPosition,
    }),
    [
      innerControlsShow,
      refreshing,
      autoConnect,
      webcamType,
      webcam,
      liveStream,
      url,
      connectCountdownTime,
      blockCrossBackendActions,
      onRefresh,
      onSwitchCamera,
      onDelay,
      onReWatch,
      onFullscreenPlayerDidPresent,
      onBuffer,
      onSeek,
      onLoad,
      onVideoTracks,
      onEnd,
      onWebcamError,
      onToggleInnerControls,
      currentSeekPosition,
    ],
  );
};

export default WebCamViewModel;
