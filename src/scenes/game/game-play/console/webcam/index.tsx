import React, {
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {getFlagText, normalizePlayerCountry} from 'platform/windows/flags';
import {findNodeHandle, NativeModules, PixelRatio, Platform} from 'react-native';
import Slider from '@react-native-community/slider';
import {
  Image as RNImage,
  Pressable,
  StatusBar,
  StyleSheet,
  View as RNView,
} from 'react-native';

import View from 'components/View';
import Text from 'components/Text';
import Video from 'components/Video';

import images from 'assets';
import i18n from 'i18n';
import colors from 'configuration/colors';
import {keys} from 'configuration/keys';

import WebCamViewModel, {Props} from './WebCamViewModel';
import LiveStreamImages from '../../livestream-images';
import PoolBroadcastScoreboard from 'components/PoolBroadcastScoreboard';
import CaromBroadcastScoreboard from 'components/CaromBroadcastScoreboard';
import {isCaromGame, isPool10Game, isPool15Game, isPool9Game} from 'utils/game';
import {shouldShowMatchOverlay} from 'utils/matchOverlay';
import {
  EMPTY_POOL_CAMERA_SCOREBOARD_STATE,
  subscribePoolCameraScoreboardState,
  type PoolCameraScoreboardState,
} from './poolScoreboardStore';
import {
  EMPTY_CAROM_CAMERA_SCOREBOARD_STATE,
  subscribeCaromCameraScoreboardState,
  type CaromCameraScoreboardState,
} from './caromScoreboardStore';
import useSafeScreenInsets, {ZERO_INSETS} from 'theme/safeArea';
import {WebcamType} from 'types/webcam';
import {setCameraFullscreen} from '../../cameraFullscreenStore';
import {updateYouTubeNativeOverlay} from 'services/youtubeNativeLive';
import useDesignSystem from 'theme/useDesignSystem';
import {createGameplayLayoutRules, createGameplayStyles} from '../../layoutRules';
import {useAplusPro} from 'features/subscription';
import {LanguageContext} from 'context/language';

const WindowsOnlyUnusedNativeLivePreview = (_props: any) => null;

const BASE_ZOOM_STEPS = [1, 2, 5, 10];

const DEBUG_CAMERA = false;
const LIVE_OVERLAY_SNAPSHOT_WIDTH = 1920;
const LIVE_OVERLAY_SNAPSHOT_HEIGHT = 1080;
const LIVE_OVERLAY_SNAPSHOT_MIN_INTERVAL_MS = 450;
const ENABLE_YOUTUBE_OVERLAY_SNAPSHOT_CAPTURE = true;

// Encoded live overlay sizing values.
// Keep gameplay camera/fullscreen/replay metrics untouched.
const LIVE_OVERLAY_LOGO_WIDTH_RATIO = 0.13;
const LIVE_OVERLAY_LOGO_HEIGHT_RATIO = 0.085;
const LIVE_OVERLAY_LOGO_MARGIN_X_RATIO = 0.025;
const LIVE_OVERLAY_LOGO_MARGIN_TOP_RATIO = 0.03;
const LIVE_OVERLAY_LOGO_MARGIN_BOTTOM_RATIO = 0.04;
const LIVE_OVERLAY_POOL_WIDTH_RATIO = 0.86;
const LIVE_OVERLAY_POOL_BOTTOM_RATIO = 0;
const LIVE_OVERLAY_POOL_HEIGHT_RATIO = 0.096;
const LIVE_OVERLAY_CAROM_SAMPLE_WIDTH_RATIO = 0.28;
const LIVE_OVERLAY_CAROM_ONLY_WIDTH_SCALE = 0.5;
const LIVE_OVERLAY_CAROM_WIDTH_RATIO =
  LIVE_OVERLAY_CAROM_SAMPLE_WIDTH_RATIO * LIVE_OVERLAY_CAROM_ONLY_WIDTH_SCALE;
const LIVE_OVERLAY_CAROM_HEIGHT_RATIO = 0.145;
const LIVE_OVERLAY_CAROM_LEFT_RATIO = 0.024;
const LIVE_OVERLAY_CAROM_BOTTOM_RATIO = 0.04;

const liveOverlayPx = (value: number) => Math.round(value);

const LIVE_OVERLAY_LOGO_WIDTH = liveOverlayPx(
  LIVE_OVERLAY_SNAPSHOT_WIDTH * LIVE_OVERLAY_LOGO_WIDTH_RATIO,
);
const LIVE_OVERLAY_LOGO_HEIGHT = liveOverlayPx(
  LIVE_OVERLAY_SNAPSHOT_HEIGHT * LIVE_OVERLAY_LOGO_HEIGHT_RATIO,
);
const LIVE_OVERLAY_LOGO_MARGIN_X = liveOverlayPx(
  LIVE_OVERLAY_SNAPSHOT_WIDTH * LIVE_OVERLAY_LOGO_MARGIN_X_RATIO,
);
const LIVE_OVERLAY_LOGO_MARGIN_TOP = liveOverlayPx(
  LIVE_OVERLAY_SNAPSHOT_HEIGHT * LIVE_OVERLAY_LOGO_MARGIN_TOP_RATIO,
);
const LIVE_OVERLAY_LOGO_MARGIN_BOTTOM = liveOverlayPx(
  LIVE_OVERLAY_SNAPSHOT_HEIGHT * LIVE_OVERLAY_LOGO_MARGIN_BOTTOM_RATIO,
);
const LIVE_OVERLAY_POOL_BOTTOM = liveOverlayPx(
  LIVE_OVERLAY_SNAPSHOT_HEIGHT * LIVE_OVERLAY_POOL_BOTTOM_RATIO,
);
const LIVE_OVERLAY_CAROM_LEFT = liveOverlayPx(
  LIVE_OVERLAY_SNAPSHOT_WIDTH * LIVE_OVERLAY_CAROM_LEFT_RATIO,
);
const LIVE_OVERLAY_CAROM_BOTTOM = liveOverlayPx(
  LIVE_OVERLAY_SNAPSHOT_HEIGHT * LIVE_OVERLAY_CAROM_BOTTOM_RATIO,
);

type LiveOverlayMode = 'pool' | 'carom';

const getLiveOverlayLayoutSpec = (mode: LiveOverlayMode) => {
  const videoWidth = LIVE_OVERLAY_SNAPSHOT_WIDTH;
  const videoHeight = LIVE_OVERLAY_SNAPSHOT_HEIGHT;
  const logoRect = {
    x: LIVE_OVERLAY_LOGO_MARGIN_X,
    y: LIVE_OVERLAY_LOGO_MARGIN_TOP,
    w: LIVE_OVERLAY_LOGO_WIDTH,
    h: LIVE_OVERLAY_LOGO_HEIGHT,
  };
  const caromSampleScoreboardWidth = liveOverlayPx(
    videoWidth * LIVE_OVERLAY_CAROM_SAMPLE_WIDTH_RATIO,
  );
  const caromScoreboardWidth = liveOverlayPx(
    caromSampleScoreboardWidth * LIVE_OVERLAY_CAROM_ONLY_WIDTH_SCALE,
  );
  const scoreboardWidth =
    mode === 'carom'
      ? caromScoreboardWidth
      : liveOverlayPx(videoWidth * LIVE_OVERLAY_POOL_WIDTH_RATIO);
  const scoreboardHeight =
    mode === 'carom'
      ? liveOverlayPx(videoHeight * LIVE_OVERLAY_CAROM_HEIGHT_RATIO)
      : liveOverlayPx(videoHeight * LIVE_OVERLAY_POOL_HEIGHT_RATIO);
  const bottomMargin =
    mode === 'carom' ? LIVE_OVERLAY_CAROM_BOTTOM : LIVE_OVERLAY_POOL_BOTTOM;
  const scoreboardRect = {
    x:
      mode === 'carom'
        ? LIVE_OVERLAY_CAROM_LEFT
        : liveOverlayPx((videoWidth - scoreboardWidth) / 2),
    y: liveOverlayPx(videoHeight - bottomMargin - scoreboardHeight),
    w: scoreboardWidth,
    h: scoreboardHeight,
  };

  return {
    videoWidth,
    videoHeight,
    logoRect,
    scoreboardRect,
    bottomMargin,
    gap: liveOverlayPx(videoHeight * 0.018),
    snapshotSize: `${videoWidth}x${videoHeight}`,
    scaleFactor: 1,
    caromOnlyWidthScale:
      mode === 'carom' ? LIVE_OVERLAY_CAROM_ONLY_WIDTH_SCALE : undefined,
    caromSampleScoreboardWidth:
      mode === 'carom' ? caromSampleScoreboardWidth : undefined,
    caromLeftAnchored: mode === 'carom',
  };
};

const formatLiveOverlayRect = (rect: {x: number; y: number; w: number; h: number}) => {
  return `${rect.x},${rect.y},${rect.w},${rect.h}`;
};

type YouTubeNativeCaptureModule = {
  captureOverlayView?: (
    nativeTag: number,
    width: number,
    height: number,
  ) => Promise<string> | string;
};

const getYouTubeNativeCaptureModule = (): YouTubeNativeCaptureModule | null => {
  const modules = NativeModules as any;
  return modules?.WindowsFfmpegLiveModule || modules?.YouTubeLiveModule || null;
};

const captureNativeYouTubeOverlayRef = async (viewRef: any): Promise<string> => {
  const nativeTag = findNodeHandle(viewRef);
  if (!nativeTag) {
    throw new Error('overlay snapshot ref is not attached to native view');
  }

  const captureModule = getYouTubeNativeCaptureModule();
  if (!captureModule?.captureOverlayView) {
    throw new Error('WindowsFfmpegLiveModule.captureOverlayView is not available');
  }

  const capturedUri = await captureModule.captureOverlayView(
    nativeTag,
    LIVE_OVERLAY_SNAPSHOT_WIDTH,
    LIVE_OVERLAY_SNAPSHOT_HEIGHT,
  );

  if (!capturedUri) {
    throw new Error('native React fullscreen overlay capture returned an empty uri');
  }

  return String(capturedUri);
};

type ThumbnailOverlayData = {
  enabled: boolean;
  topLeft: string[];
  topRight: string[];
  bottomLeft: string[];
  bottomRight: string[];
};

const EMPTY_THUMBNAILS: ThumbnailOverlayData = {
  enabled: false,
  topLeft: [],
  topRight: [],
  bottomLeft: [],
  bottomRight: [],
};

const debugCameraLog = (...args: any[]) => {
  if (DEBUG_CAMERA) {
    console.log(...args);
  }
};

type CameraZoomInfo = {
  supported?: boolean;
  minZoom?: number;
  maxZoom?: number;
  zoom?: number;
  source?: string;
};

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(value, max));
};

const getNearestStepIndex = (steps: number[], value: number) => {
  if (!steps.length) {
    return 0;
  }

  return steps.reduce((bestIndex, step, index) => {
    const bestDistance = Math.abs(steps[bestIndex] - value);
    const currentDistance = Math.abs(step - value);
    return currentDistance < bestDistance ? index : bestIndex;
  }, 0);
};

const formatZoomLabel = (value: number) => {
  if (value >= 10 || Number.isInteger(value)) {
    return `${value.toFixed(0)}x`;
  }

  return `${value.toFixed(1)}x`;
};


const areNumberArraysEqual = (left: number[] = [], right: number[] = []) => {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (Number(left[index]) !== Number(right[index])) {
      return false;
    }
  }

  return true;
};

const getYouTubeSourceLock = (): 'back' | 'front' | 'external' | null => {
  const value = (globalThis as any).__APLUS_YOUTUBE_SOURCE_LOCK__;
  return value === 'back' || value === 'front' || value === 'external'
    ? value
    : null;
};

const getCurrentCameraSourceSnapshot = (): 'back' | 'front' | 'external' | null => {
  const value = (globalThis as any).__APLUS_CURRENT_CAMERA_SOURCE__;
  return value === 'back' || value === 'front' || value === 'external'
    ? value
    : null;
};

const hasDetectedExternalWebcam = (): boolean => {
  return (globalThis as any).__APLUS_UVC_PRESENT__ === true;
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

type WebCamComponentProps = Props & {
  hideBottomControls?: boolean;
  cameraScaleMode?: 'contain' | 'cover';
  forceFullscreen?: boolean;
};

export type WebCamHandle = {
  refresh: () => void;
  switchCamera: () => void;
  rewatch: () => void;
  canRefresh: () => boolean;
  canSwitchCamera: () => boolean;
  canRewatch: () => boolean;
};

const LiveStreamImagesOverlay = memo(() => {
  const [state, setState] = useState<PoolCameraScoreboardState>(
    EMPTY_POOL_CAMERA_SCOREBOARD_STATE,
  );

  useEffect(() => {
    return subscribePoolCameraScoreboardState(setState);
  }, []);

  if (!shouldShowMatchOverlay(state.gameSettings, state.playerSettings)) {
    return null;
  }

  return (
    <RNView pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LiveStreamImages
        currentPlayerIndex={state.currentPlayerIndex}
        countdownTime={state.countdownTime}
        gameSettings={state.gameSettings}
        playerSettings={state.playerSettings}
      />
    </RNView>
  );
});

type CameraScoreboardOverlayProps = {
  fullscreenMode?: boolean;
  bottomOffset?: number;
  liveOutput?: boolean;
  liveVideoWidth?: number;
  liveVideoHeight?: number;
};

const PoolScoreboardOverlay = memo(({
  fullscreenMode = false,
  bottomOffset,
  liveOutput = false,
  liveVideoWidth = LIVE_OVERLAY_SNAPSHOT_WIDTH,
  liveVideoHeight = LIVE_OVERLAY_SNAPSHOT_HEIGHT,
}: CameraScoreboardOverlayProps) => {
  const [state, setState] = useState<PoolCameraScoreboardState>(
    EMPTY_POOL_CAMERA_SCOREBOARD_STATE,
  );

  useEffect(() => {
    return subscribePoolCameraScoreboardState(setState);
  }, []);

  const poolCategory = state.gameSettings?.category;
  const shouldShowPool =
    shouldShowMatchOverlay(state.gameSettings, state.playerSettings) &&
    (isPool9Game(poolCategory) ||
      isPool10Game(poolCategory) ||
      isPool15Game(poolCategory));

  if (!shouldShowPool) {
    return null;
  }

  return (
    <PoolBroadcastScoreboard
      currentPlayerIndex={state.currentPlayerIndex}
      countdownTime={state.countdownTime}
      gameSettings={state.gameSettings}
      playerSettings={state.playerSettings}
      variant={liveOutput ? 'live' : fullscreenMode ? 'fullscreen' : 'camera'}
      bottomOffset={bottomOffset ?? 0}
      liveVideoWidth={liveVideoWidth}
      liveVideoHeight={liveVideoHeight}
    />
  );
});

const CaromScoreboardOverlay = memo(({
  fullscreenMode = false,
  bottomOffset,
  liveOutput = false,
  liveVideoWidth = LIVE_OVERLAY_SNAPSHOT_WIDTH,
  liveVideoHeight = LIVE_OVERLAY_SNAPSHOT_HEIGHT,
}: CameraScoreboardOverlayProps) => {
  const [state, setState] = useState<CaromCameraScoreboardState>(
    EMPTY_CAROM_CAMERA_SCOREBOARD_STATE,
  );

  useEffect(() => {
    return subscribeCaromCameraScoreboardState(setState);
  }, []);

  const shouldShowCarom =
    (fullscreenMode || liveOutput) &&
    shouldShowMatchOverlay(state.gameSettings, state.playerSettings) &&
    isCaromGame(state.gameSettings?.category);

  if (!shouldShowCarom) {
    return null;
  }

  return (
    <CaromBroadcastScoreboard
      currentPlayerIndex={state.currentPlayerIndex}
      countdownTime={state.countdownTime}
      totalTurns={state.totalTurns}
      gameSettings={state.gameSettings}
      playerSettings={state.playerSettings}
      variant={liveOutput ? 'live' : fullscreenMode ? 'fullscreen' : 'camera'}
      bottomOffset={bottomOffset ?? (liveOutput ? LIVE_OVERLAY_CAROM_BOTTOM : undefined)}
      liveVideoWidth={liveVideoWidth}
      liveVideoHeight={liveVideoHeight}
    />
  );
});

const WebCam = forwardRef<WebCamHandle, WebCamComponentProps>((props, ref) => {
  const {language} = useContext(LanguageContext);
  void language;
  const viewModel = WebCamViewModel(props);
  const {isAplusProActive, showPaywall} = useAplusPro();
  const isCameraPremiumLocked = !isAplusProActive;
  const {adaptive, design} = useDesignSystem();
  const safeInsets = useSafeScreenInsets();
  const overlaySafeInsets = useMemo(() => ({
    ...safeInsets,
    top: ZERO_INSETS.top,
  }), [safeInsets.bottom, safeInsets.left, safeInsets.right, safeInsets.top]);
  const layoutRules = useMemo(() => createGameplayLayoutRules(adaptive, design), [adaptive.styleKey]);
  const styles = useMemo(() => createStyles(adaptive, design, layoutRules, overlaySafeInsets), [adaptive.styleKey, overlaySafeInsets.top, overlaySafeInsets.right, overlaySafeInsets.bottom, overlaySafeInsets.left]);
  const cameraScaleMode = props.cameraScaleMode || 'cover';
  const isFullscreen = !!props.forceFullscreen;
  const showCameraPaywall = useCallback(() => {
    showPaywall('camera');
  }, [showPaywall]);

  const [cameraVisualReady, setCameraVisualReady] = useState(false);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomMin, setZoomMin] = useState(1);
  const [zoomMax, setZoomMax] = useState(1);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [thumbnailOverlay, setThumbnailOverlay] =
    useState<ThumbnailOverlayData>(EMPTY_THUMBNAILS);
  const [matchOverlayState, setMatchOverlayState] =
    useState<PoolCameraScoreboardState>(EMPTY_POOL_CAMERA_SCOREBOARD_STATE);
  const [caromOverlayState, setCaromOverlayState] =
    useState<CaromCameraScoreboardState>(EMPTY_CAROM_CAMERA_SCOREBOARD_STATE);
  const liveOverlaySnapshotRef = useRef<RNView | null>(null);
  const liveOverlaySnapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLiveOverlaySnapshotSignatureRef = useRef('');
  const lastLiveOverlaySnapshotAtRef = useRef(0);
  const lastLiveOverlayFullscreenStateRef = useRef<boolean | null>(null);
  const [liveOverlaySnapshotLayout, setLiveOverlaySnapshotLayout] = useState({
    width: LIVE_OVERLAY_SNAPSHOT_WIDTH,
    height: LIVE_OVERLAY_SNAPSHOT_HEIGHT,
  });

  useEffect(() => {
    return subscribePoolCameraScoreboardState(setMatchOverlayState);
  }, []);

  useEffect(() => {
    return subscribeCaromCameraScoreboardState(setCaromOverlayState);
  }, []);

  const shouldShowCameraMatchOverlay = shouldShowMatchOverlay(
    matchOverlayState.gameSettings,
    matchOverlayState.playerSettings,
  );
  const poolOverlayCategory = matchOverlayState.gameSettings?.category;
  const shouldShowPoolSnapshotOverlay =
    shouldShowCameraMatchOverlay &&
    (isPool9Game(poolOverlayCategory) ||
      isPool10Game(poolOverlayCategory) ||
      isPool15Game(poolOverlayCategory));
  const shouldShowCaromSnapshotOverlay =
    shouldShowMatchOverlay(caromOverlayState.gameSettings, caromOverlayState.playerSettings) &&
    isCaromGame(caromOverlayState.gameSettings?.category);

  useEffect(() => {
    if (!props.forceFullscreen) {
      return;
    }

    const applyFullscreenSystemChrome = () => {
      StatusBar.setHidden(true, 'none');

    };

    applyFullscreenSystemChrome();
    const timers = [80, 220, 500, 900].map(delay =>
      setTimeout(applyFullscreenSystemChrome, delay),
    );

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [props.forceFullscreen]);

  const zoomSupportedRef = useRef(false);
  const zoomMinRef = useRef(1);
  const zoomMaxRef = useRef(1);
  const currentZoomRef = useRef(1);
  const youtubeControllerRef = useRef<any>(null);
  const lastStableZoomInfoRef = useRef<CameraZoomInfo | null>(null);
  const fullscreenSourceRef =
    useRef<'back' | 'front' | 'external' | null>(null);

  const loadThumbnailOverlay = useCallback(async () => {
    try {
      const result = await AsyncStorage.multiGet([
        keys.SHOW_THUMBNAILS_ON_LIVESTREAM,
        keys.THUMBNAILS_TOP_LEFT,
        keys.THUMBNAILS_TOP_RIGHT,
        keys.THUMBNAILS_BOTTOM_LEFT,
        keys.THUMBNAILS_BOTTOM_RIGHT,
      ]);

      const parseImages = (value: string | null): string[] => {
        if (!value) {
          return [];
        }

        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch {
          return [];
        }
      };

      const topLeft = parseImages(result?.[1]?.[1] ?? null);
      const topRight = parseImages(result?.[2]?.[1] ?? null);
      const bottomLeft = parseImages(result?.[3]?.[1] ?? null);
      const bottomRight = parseImages(result?.[4]?.[1] ?? null);
      const hasAnyOverlayImages =
        topLeft.length > 0 ||
        topRight.length > 0 ||
        bottomLeft.length > 0 ||
        bottomRight.length > 0;

      const enabledRaw = result?.[0]?.[1];
      const enabledFromStorage =
        typeof enabledRaw === 'string'
          ? enabledRaw === '1' || enabledRaw.toLowerCase() === 'true'
          : enabledRaw == null
            ? true
            : !!enabledRaw;

      const enabled = enabledFromStorage || hasAnyOverlayImages;

      if (enabled && !enabledFromStorage) {
        try {
          await AsyncStorage.setItem(keys.SHOW_THUMBNAILS_ON_LIVESTREAM, '1');
          console.log('[WebCam] repaired thumbnail overlay enabled flag');
        } catch (persistError) {
          console.log('[WebCam] failed to repair thumbnail overlay enabled flag', persistError);
        }
      }

      if (false) {
        console.log('[WebCam] thumbnail overlay loaded', {
          enabled,
          enabledFromStorage,
          topLeftCount: topLeft.length,
          topRightCount: topRight.length,
          bottomLeftCount: bottomLeft.length,
          bottomRightCount: bottomRight.length,
        });
      }

      setThumbnailOverlay({
        enabled,
        topLeft: enabled ? topLeft : [],
        topRight: enabled ? topRight : [],
        bottomLeft: enabled ? bottomLeft : [],
        bottomRight: enabled ? bottomRight : [],
      });
    } catch (error) {
      console.log('[WebCam] load thumbnail overlay failed', error);
      setThumbnailOverlay(EMPTY_THUMBNAILS);
    }
  }, []);

  useEffect(() => {
    if (!isFullscreen) {
      fullscreenSourceRef.current = null;
    }

    return () => {
      fullscreenSourceRef.current = null;
    };
  }, [isFullscreen]);

  useEffect(() => {
    // Load thumbnail overlay once. Polling AsyncStorage every second caused
    // unnecessary RNW render/log pressure during Windows YouTube Live.
    loadThumbnailOverlay();
  }, [loadThumbnailOverlay]);

  // Livestream must not push a separate native/canvas scoreboard model.
  // The React camera overlay below is the single source of truth for
  // embedded camera, fullscreen, replay, and local live preview.

  const liveSourceLock = getYouTubeSourceLock();
  const currentCameraSource = getCurrentCameraSourceSnapshot();
  const recordingInfo = getCameraRecordingInfo(props.cameraRef);

  const externalLiveLocked =
    recordingInfo?.isRecording === true &&
    (recordingInfo?.source === 'external' || liveSourceLock === 'external');

  const baseCameraSource = currentCameraSource || liveSourceLock || 'back';

  const effectiveCameraSource =
    (isFullscreen ? fullscreenSourceRef.current : null) || baseCameraSource;

  const effectiveCameraFacing =
    effectiveCameraSource === 'front' ? 'front' : 'back';

  const effectiveSourceType =
    effectiveCameraSource === 'external' ? 'webcam' : 'phone';

  const showLogoOnly = !hasDetectedExternalWebcam();
  const streamUri =
    typeof viewModel.source?.uri === 'string' ? viewModel.source.uri.trim() : '';
  const hasStreamUri = streamUri.length > 0;
  const handleCameraReadyChange = useCallback(
    (nextReady: boolean) => {
      if (isCameraPremiumLocked) {
        setCameraVisualReady(false);
        props.setIsCameraReady(false);
        return;
      }
      setCameraVisualReady(prev => (prev === nextReady ? prev : nextReady));
      props.setIsCameraReady(nextReady);
      debugCameraLog('[WebCam] visual ready changed', {
        nextReady,
        effectiveCameraSource,
        effectiveSourceType,
        streamUri,
      });
    },
    [effectiveCameraSource, effectiveSourceType, isCameraPremiumLocked, props.setIsCameraReady, streamUri],
  );

  useEffect(() => {
    if (isCameraPremiumLocked) {
      setCameraVisualReady(false);
      props.setIsCameraReady(false);
      return;
    }

    setCameraVisualReady(false);
    debugCameraLog('[WebCam] reset visual ready for source signature', {
      effectiveCameraSource,
      effectiveSourceType,
      streamUri,
      youtubeLivePreviewActive: !!props.youtubeLivePreviewActive,
      refreshing: !!viewModel.refreshing,
    });
  }, [
    effectiveCameraSource,
    effectiveSourceType,
    isCameraPremiumLocked,
    streamUri,
    props.youtubeLivePreviewActive,
    viewModel.refreshing,
  ]);

  const effectiveCameraReady =
    effectiveSourceType === 'phone' && Platform.OS !== 'windows'
      ? props.isCameraReady && cameraVisualReady
      : props.isCameraReady || cameraVisualReady;
  const shouldShowPhonePlaceholder =
    effectiveSourceType === 'phone' && !effectiveCameraReady;
  const shouldShowPhoneLogoOverlay = false;
  const shouldShowExternalPlaceholder =
    effectiveSourceType === 'webcam' &&
    (!effectiveCameraReady || viewModel.refreshing);
  const shouldShowLogoPlaceholder =
    isCameraPremiumLocked || shouldShowPhonePlaceholder || shouldShowExternalPlaceholder;
  // v51: keep preview visible during Windows YouTube live. Native live capture now
  // runs in parallel using its own shared-read MediaCapture reader.
  const releaseCameraPreviewForFfmpegLive = false;
  const shouldRenderVideoComponent =
    !isCameraPremiumLocked &&
    !releaseCameraPreviewForFfmpegLive &&
    (!viewModel.refreshing || useYouTubeNativePreview);
  const shouldRenderPreview = !isCameraPremiumLocked && shouldRenderVideoComponent && effectiveCameraReady;
  const shouldShowOuterLogoOverlay = false;

  useEffect(() => {
    debugCameraLog('[WebCam] placeholder branch', {
      effectiveCameraSource,
      effectiveSourceType,
      streamUri,
      hasStreamUri,
      propsIsCameraReady: props.isCameraReady,
      cameraVisualReady,
      effectiveCameraReady,
      shouldShowPhonePlaceholder,
      shouldShowPhoneLogoOverlay,
      shouldShowExternalPlaceholder,
      shouldShowLogoPlaceholder,
      shouldShowOuterLogoOverlay,
    });
  }, [
    cameraVisualReady,
    effectiveCameraSource,
    effectiveSourceType,
    effectiveCameraReady,
    hasStreamUri,
    props.isCameraReady,
    shouldShowExternalPlaceholder,
    shouldShowLogoPlaceholder,
    shouldShowOuterLogoOverlay,
    shouldShowPhoneLogoOverlay,
    shouldShowPhonePlaceholder,
    streamUri,
  ]);

  const canRewatch = useMemo(() => {
    return props.isStarted && props.isPaused;
  }, [props.isStarted, props.isPaused]);

  const getCameraHandle = useCallback(() => {
    if (props.youtubeLivePreviewActive && !externalLiveLocked) {
      return youtubeControllerRef.current;
    }
    return (props.cameraRef as any)?.current ?? null;
  }, [props.cameraRef, props.youtubeLivePreviewActive, externalLiveLocked]);


const syncZoomInfo = useCallback(() => {
  const cameraHandle = getCameraHandle();
  const info = cameraHandle?.getZoomInfo?.() as CameraZoomInfo | undefined;

  const commitZoomState = (
    nextZoomSupported: boolean,
    nextMinZoom: number,
    nextMaxZoom: number,
    nextCurrentZoom: number,
  ) => {
    if (zoomSupportedRef.current !== nextZoomSupported) {
      zoomSupportedRef.current = nextZoomSupported;
      setZoomSupported(nextZoomSupported);
    }

    if (Number(zoomMinRef.current) !== Number(nextMinZoom)) {
      zoomMinRef.current = nextMinZoom;
      setZoomMin(nextMinZoom);
    }

    if (Number(zoomMaxRef.current) !== Number(nextMaxZoom)) {
      zoomMaxRef.current = nextMaxZoom;
      setZoomMax(nextMaxZoom);
    }

    if (Number(currentZoomRef.current) !== Number(nextCurrentZoom)) {
      currentZoomRef.current = nextCurrentZoom;
      setCurrentZoom(nextCurrentZoom);
    }
  };

  if (!info) {
    const fallback = lastStableZoomInfoRef.current;
    if (fallback) {
      const minZoom =
        typeof fallback.minZoom === 'number' ? fallback.minZoom : 1;
      const maxZoom =
        typeof fallback.maxZoom === 'number' ? fallback.maxZoom : 1;
      const zoom = clamp(
        typeof fallback.zoom === 'number' ? fallback.zoom : 1,
        minZoom,
        maxZoom,
      );

      commitZoomState(!!fallback.supported || maxZoom > 1.001, minZoom, maxZoom, zoom);
      return;
    }

    commitZoomState(false, 1, 1, 1);
    return;
  }

  const minZoom = typeof info.minZoom === 'number' ? info.minZoom : 1;
  const maxZoom = typeof info.maxZoom === 'number' ? info.maxZoom : 1;
  const zoom = clamp(
    typeof info.zoom === 'number' ? info.zoom : 1,
    minZoom,
    maxZoom,
  );

  if (info.supported || maxZoom > 1.001) {
    lastStableZoomInfoRef.current = {
      ...info,
      supported: true,
      minZoom,
      maxZoom,
      zoom,
    };
  }

  commitZoomState(!!info.supported || maxZoom > 1.001, minZoom, maxZoom, zoom);
}, [getCameraHandle]);

  useEffect(() => {
    syncZoomInfo();

    const timeouts = [150, 500, 1200].map(delay => {
      return setTimeout(() => {
        syncZoomInfo();
      }, delay);
    });

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [syncZoomInfo, isFullscreen, props.isCameraReady]);


const applyZoom = useCallback(
  (nextZoom: number, options?: {finalize?: boolean}) => {
    const cameraHandle = getCameraHandle();
    if (!cameraHandle?.setZoom) {
      return;
    }

    const info = cameraHandle?.getZoomInfo?.() as CameraZoomInfo | undefined;
    const minZoom = typeof info?.minZoom === 'number' ? info.minZoom : zoomMinRef.current;
    const maxZoom = typeof info?.maxZoom === 'number' ? info.maxZoom : zoomMaxRef.current;
    const clampedZoom = clamp(nextZoom, minZoom, maxZoom);
    const appliedZoom = cameraHandle.setZoom(clampedZoom);
    const resolvedZoom = typeof appliedZoom === 'number' ? appliedZoom : clampedZoom;

    currentZoomRef.current = resolvedZoom;
    setCurrentZoom(resolvedZoom);

    if (lastStableZoomInfoRef.current) {
      lastStableZoomInfoRef.current = {
        ...lastStableZoomInfoRef.current,
        supported: maxZoom > minZoom + 0.001,
        minZoom,
        maxZoom,
        zoom: resolvedZoom,
      };
    } else {
      lastStableZoomInfoRef.current = {
        supported: maxZoom > minZoom + 0.001,
        minZoom,
        maxZoom,
        zoom: resolvedZoom,
        source: effectiveCameraSource,
      };
    }

    if (options?.finalize) {
      syncZoomInfo();
    }
  },
  [effectiveCameraSource, getCameraHandle, syncZoomInfo],
);

const sliderMinZoom = useMemo(() => {
  const normalizedMin = Number.isFinite(zoomMin) ? zoomMin : 1;
  const normalizedMax = Number.isFinite(zoomMax) ? zoomMax : 1;
  return clamp(Math.max(1, normalizedMin), 1, Math.max(1, normalizedMax));
}, [zoomMin, zoomMax]);

const sliderMaxZoom = useMemo(() => {
  const normalizedMax = Number.isFinite(zoomMax) ? zoomMax : 1;
  return Math.min(10, Math.max(sliderMinZoom, normalizedMax));
}, [sliderMinZoom, zoomMax]);

const sliderZoomSupported = zoomSupported && sliderMaxZoom - sliderMinZoom > 0.001;

const handleZoomSliderChange = useCallback(
  (nextValue: number) => {
    if (!sliderZoomSupported) {
      return;
    }

    applyZoom(nextValue);
  },
  [applyZoom, sliderZoomSupported],
);

const handleZoomSliderComplete = useCallback(
  (nextValue: number) => {
    if (!sliderZoomSupported) {
      return;
    }

    applyZoom(nextValue, {finalize: true});
  },
  [applyZoom, sliderZoomSupported],
);

  const openFullscreen = () => {
    if (isCameraPremiumLocked) {
      showCameraPaywall();
      return;
    }

    const nextSource =
      effectiveCameraSource === 'front' ||
      effectiveCameraSource === 'back' ||
      effectiveCameraSource === 'external'
        ? effectiveCameraSource
        : currentCameraSource ||
          liveSourceLock ||
          (viewModel.webcamType === WebcamType.webcam ? 'external' : 'back');

    fullscreenSourceRef.current = nextSource;
    setCameraFullscreen(true);
  };

  const closeFullscreen = () => {
    fullscreenSourceRef.current = null;
    setCameraFullscreen(false);
  };
  const onSwitchCameraPress = () => {
    if (isCameraPremiumLocked) {
      showCameraPaywall();
      return;
    }

    if (externalLiveLocked) {
      debugCameraLog(
        '[WebCam] block switch camera while external recording lock is active',
      );
      return;
    }

    viewModel.onSwitchCamera();
  };

  // v56: Do NOT switch the visible Windows camera to the unused native preview branch.
  // That branch renders a placeholder/null view on Windows and made the in-game camera
  // turn black during YouTube live. Keep the normal <Video /> preview mounted.
  const useYouTubeNativePreview = false;
  // Still publish the offscreen fullscreen-style overlay snapshot for the live encoder.
  const shouldPublishWindowsLiveOverlaySnapshot =
    Platform.OS === 'windows' && !!props.youtubeLivePreviewActive;
  // Native live no longer owns any scoreboard/logo overlay. Keep the same
  // React overlay used by normal camera/fullscreen/replay visible during live.
  const suppressReactMatchOverlayForNativeLive = false;
  const shouldPublishGameplayOverlaySnapshot =
    ENABLE_YOUTUBE_OVERLAY_SNAPSHOT_CAPTURE &&
    shouldPublishWindowsLiveOverlaySnapshot &&
    (shouldShowPoolSnapshotOverlay || shouldShowCaromSnapshotOverlay);
  const liveOverlaySnapshotReady =
    liveOverlaySnapshotLayout.width > 0 && liveOverlaySnapshotLayout.height > 0;

  const isExplicitRecording =
    recordingInfo?.isRecording === true ||
    recordingInfo?.state === 'starting' ||
    recordingInfo?.state === 'recording' ||
    recordingInfo?.state === 'stopping';

  const isVideoSessionLocked =
    isExplicitRecording || !!props.youtubeLivePreviewActive || externalLiveLocked;

  const allowRefresh = !isCameraPremiumLocked && !viewModel.refreshing && !isVideoSessionLocked;

  const allowSwitchCamera = !isCameraPremiumLocked && !isVideoSessionLocked;
  const lastButtonAvailabilityLogRef = useRef('');

  useEffect(() => {
    if (!__DEV__ || !DEBUG_CAMERA) {
      return;
    }

    const payload = {
      allowRefresh,
      allowSwitchCamera,
      isExplicitRecording,
      isVideoSessionLocked,
      recordingState: recordingInfo?.state || 'idle',
      refreshing: viewModel.refreshing,
      youtubeLivePreviewActive: !!props.youtubeLivePreviewActive,
    };

    const key = JSON.stringify(payload);
    if (key === lastButtonAvailabilityLogRef.current) {
      return;
    }

    lastButtonAvailabilityLogRef.current = key;
    debugCameraLog('[WebCam] button availability:', payload);
  }, [
    allowRefresh,
    allowSwitchCamera,
    isExplicitRecording,
    isVideoSessionLocked,
    recordingInfo?.state,
    viewModel.refreshing,
    props.youtubeLivePreviewActive,
  ]);

  const [cameraStageBounds, setCameraStageBounds] = useState({width: 0, height: 0});

  const targetCameraAspectRatio = useMemo(() => {
    if (effectiveCameraSource === 'external') {
      return 16 / 9;
    }

    return props.innerControls ? 2 : 16 / 10;
  }, [effectiveCameraSource, props.innerControls]);

  const cameraStageStyle = undefined;

  const showBottomControls =
    (!props.innerControls || viewModel.innerControlsShow) &&
    !isFullscreen &&
    !props.hideBottomControls;

  useImperativeHandle(
    ref,
    () => ({
      refresh: () => {
        if (isCameraPremiumLocked) {
          showCameraPaywall();
          return;
        }

        if (allowRefresh) {
          viewModel.onRefresh();
        }
      },
      switchCamera: () => {
        if (isCameraPremiumLocked) {
          showCameraPaywall();
          return;
        }

        if (allowSwitchCamera) {
          onSwitchCameraPress();
        }
      },
      rewatch: () => {
        if (canRewatch) {
          viewModel.onReWatch();
        }
      },
      canRefresh: () => !!allowRefresh,
      canSwitchCamera: () => !!allowSwitchCamera,
      canRewatch: () => !!canRewatch,
    }),
    [
      allowRefresh,
      allowSwitchCamera,
      canRewatch,
      isCameraPremiumLocked,
      onSwitchCameraPress,
      showCameraPaywall,
      viewModel,
    ],
  );

  const fullLogoPlaceholder = (
    <RNView style={styles.logoOnlyBackground}>
      <RNImage
        source={images.logoSmall}
        style={styles.logoOnlyImage}
        resizeMode="contain"
        onLoad={() => {
          debugCameraLog('[WebCam] logo placeholder loaded', {
            source: effectiveCameraSource,
            type: effectiveSourceType,
            shouldShowLogoPlaceholder,
          });
        }}
        onError={error => {
          console.log('[WebCam] logo placeholder image error', error?.nativeEvent || error);
        }}
      />
    </RNView>
  );

  const hasThumbnailImages =
    thumbnailOverlay.topLeft.length > 0 ||
    thumbnailOverlay.topRight.length > 0 ||
    thumbnailOverlay.bottomLeft.length > 0 ||
    thumbnailOverlay.bottomRight.length > 0;

  const liveOverlaySnapshotSignature = useMemo(() => {
    if (!shouldPublishGameplayOverlaySnapshot) {
      return 'hidden';
    }

    const mode = shouldShowCaromSnapshotOverlay ? 'carom' : 'pool';
    const poolPlayers = matchOverlayState.playerSettings?.playingPlayers || [];
    const caromPlayers = caromOverlayState.playerSettings?.playingPlayers || [];
    const players = mode === 'carom' ? caromPlayers : poolPlayers;

    return JSON.stringify({
      mode,
      currentPlayerIndex: mode === 'carom'
        ? caromOverlayState.currentPlayerIndex
        : matchOverlayState.currentPlayerIndex,
      countdownTime: mode === 'carom'
        ? caromOverlayState.countdownTime
        : matchOverlayState.countdownTime,
      totalTurns: caromOverlayState.totalTurns,
      poolGoal: matchOverlayState.gameSettings?.players?.goal?.goal ?? matchOverlayState.playerSettings?.goal?.goal,
      caromGoal: caromOverlayState.gameSettings?.players?.goal?.goal ?? caromOverlayState.playerSettings?.goal?.goal,
      players: players.map((player: any) => ({
        name: player?.name,
        flag: getFlagText(normalizePlayerCountry(player)),
        totalPoint: player?.totalPoint,
        currentPoint: player?.proMode?.currentPoint,
        highestRate: player?.proMode?.highestRate,
        secondHighestRate: player?.proMode?.secondHighestRate,
        average: player?.proMode?.average,
      })),
      thumbnails: thumbnailOverlay,
      hasThumbnailImages,
      fullscreen: isFullscreen,
      activeSource: 'offscreen-live-overlay',
    });
  }, [
    caromOverlayState,
    hasThumbnailImages,
    isFullscreen,
    matchOverlayState,
    shouldPublishGameplayOverlaySnapshot,
    shouldShowCaromSnapshotOverlay,
    thumbnailOverlay,
  ]);

  useEffect(() => {
    if (liveOverlaySnapshotTimerRef.current) {
      clearTimeout(liveOverlaySnapshotTimerRef.current);
      liveOverlaySnapshotTimerRef.current = null;
    }

    if (!shouldPublishWindowsLiveOverlaySnapshot) {
      lastLiveOverlaySnapshotSignatureRef.current = '';
      lastLiveOverlaySnapshotAtRef.current = 0;
      void updateYouTubeNativeOverlay({
        visible: false,
        source: 'gameplay-shared-overlay-snapshot',
      } as any);
      return;
    }

    if (!shouldPublishGameplayOverlaySnapshot) {
      lastLiveOverlaySnapshotSignatureRef.current = 'hidden';
      void updateYouTubeNativeOverlay({
        visible: false,
        source: 'gameplay-shared-overlay-snapshot',
      } as any);
      return;
    }

    if (!liveOverlaySnapshotReady) {
      lastLiveOverlaySnapshotSignatureRef.current = 'waiting-layout';
      console.log(
        '[Live Overlay] desiredSource=gameplay-shared-overlay mounted=false snapshotEnabled=true overlaySkipReason=snapshot-view-not-laid-out keepLastGoodOverlay=true',
      );
      console.log(
        `[Live Overlay Fullscreen] fullscreen=${isFullscreen} activeSource=offscreen-live-overlay snapshotRequested=false snapshotSkipReason=layout-zero overlayBitmapStillAvailable=true`,
      );
      // Do not send visible=false here: fullscreen enter/exit can temporarily
      // remount/layout the source view. Native must keep the last good overlay
      // bitmap until a fresh offscreen snapshot succeeds.
      return;
    }

    if (liveOverlaySnapshotSignature === lastLiveOverlaySnapshotSignatureRef.current) {
      return;
    }

    const delayMs = Math.max(
      80,
      LIVE_OVERLAY_SNAPSHOT_MIN_INTERVAL_MS -
        (Date.now() - lastLiveOverlaySnapshotAtRef.current),
    );

    let cancelled = false;
    liveOverlaySnapshotTimerRef.current = setTimeout(() => {
      liveOverlaySnapshotTimerRef.current = null;

      const captureOverlay = async () => {
        const overlayRef = liveOverlaySnapshotRef.current;
        if (!overlayRef || cancelled) {
          console.log(
            `[Live Overlay Fullscreen] fullscreen=${isFullscreen} activeSource=offscreen-live-overlay snapshotCaptured=false snapshotSkipReason=ref-null overlayBitmapStillAvailable=true`,
          );
          return;
        }

        try {
          const mode = shouldShowCaromSnapshotOverlay ? 'carom' : 'pool';
          const devicePixelRatio = PixelRatio.get();
          const layoutSpec = getLiveOverlayLayoutSpec(mode);
          const previousFullscreen = lastLiveOverlayFullscreenStateRef.current;
          const snapshotReason =
            previousFullscreen === null
              ? 'initial'
              : previousFullscreen !== isFullscreen
                ? isFullscreen
                  ? 'fullscreen-enter'
                  : 'fullscreen-exit'
                : 'state-change';
          console.log(
            `[Live Overlay Fullscreen] fullscreen=${isFullscreen} previousSourceRefMounted=${!!overlayRef} activeSource=offscreen-live-overlay snapshotRequested=true reason=${snapshotReason}`,
          );
          console.log(
            `[Live Overlay] desiredSource=gameplay-shared-overlay mounted=true size=${liveOverlaySnapshotLayout.width}x${liveOverlaySnapshotLayout.height} mode=${mode} players=2 snapshotEnabled=true`,
          );
          console.log(
            `[Live Overlay] snapshotRequested reason=${snapshotReason} source=gameplay-overlay layout=${liveOverlaySnapshotLayout.width}x${liveOverlaySnapshotLayout.height} mode=${mode} players=2`,
          );
          const caromLayoutLogSuffix =
            mode === 'carom'
              ? ` caromOnlyWidthScale=${layoutSpec.caromOnlyWidthScale} caromSampleWidth=${layoutSpec.caromSampleScoreboardWidth} leftAnchored=true poolUnchanged=true logoUnchanged=true`
              : ' poolUnchanged=true logoUnchanged=true';
          console.log(
            `[Live Overlay Layout] video=${layoutSpec.videoWidth}x${layoutSpec.videoHeight} sampleBased=true mode=${mode} logoRect=${formatLiveOverlayRect(layoutSpec.logoRect)} scoreboardRect=${formatLiveOverlayRect(layoutSpec.scoreboardRect)} bottomMargin=${layoutSpec.bottomMargin} gap=${layoutSpec.gap} snapshotSize=${layoutSpec.snapshotSize} scaleFactor=${layoutSpec.scaleFactor}${caromLayoutLogSuffix}`,
          );
          console.log(
            `[Live Overlay Quality] devicePixelRatio=${devicePixelRatio} viewLayout=${liveOverlaySnapshotLayout.width}x${liveOverlaySnapshotLayout.height} snapshotSize=${LIVE_OVERLAY_SNAPSHOT_WIDTH}x${LIVE_OVERLAY_SNAPSHOT_HEIGHT} videoOutput=encoder-size overlayDrawRect=${formatLiveOverlayRect(layoutSpec.scoreboardRect)} overlaySharp=true reason=snapshot-size-matches-live-layout`,
          );

          const capturedUri = await captureNativeYouTubeOverlayRef(overlayRef);

          if (cancelled || !capturedUri) {
            return;
          }

          lastLiveOverlaySnapshotSignatureRef.current = liveOverlaySnapshotSignature;
          lastLiveOverlaySnapshotAtRef.current = Date.now();
          lastLiveOverlayFullscreenStateRef.current = isFullscreen;

          console.log(
            `[Live Overlay Fullscreen] fullscreen=${isFullscreen} activeSource=offscreen-live-overlay snapshotCaptured=true width=${LIVE_OVERLAY_SNAPSHOT_WIDTH} height=${LIVE_OVERLAY_SNAPSHOT_HEIGHT} overlayBitmapStillAvailable=true`,
          );
          console.log(
            `[Live Overlay Snapshot] captured=true source=gameplay-overlay width=${LIVE_OVERLAY_SNAPSHOT_WIDTH} height=${LIVE_OVERLAY_SNAPSHOT_HEIGHT} format=png quality=lossless`,
          );
          console.log(`[Live Overlay] source=gameplay-shared-overlay mode=${mode} players=2 updated=true`);
          console.log('[Live Output] frameSource=raw-camera+snapshot-overlay overlayAppliedToEncodedFrame=pending-native-apply');

          await updateYouTubeNativeOverlay({
            visible: true,
            variant: mode,
            source: 'gameplay-shared-overlay-snapshot',
            snapshotUri: capturedUri,
            snapshotWidth: LIVE_OVERLAY_SNAPSHOT_WIDTH,
            snapshotHeight: LIVE_OVERLAY_SNAPSHOT_HEIGHT,
            updatedAt: Date.now(),
          } as any);
        } catch (error) {
          console.log('[Live Overlay Snapshot] captured=false source=gameplay-overlay error=', error);
          console.log(
            `[Live Overlay Fullscreen] fullscreen=${isFullscreen} activeSource=offscreen-live-overlay snapshotCaptured=false snapshotSkipReason=unknown overlayBitmapStillAvailable=true`,
          );
        }
      };

      void captureOverlay();
    }, delayMs);

    return () => {
      cancelled = true;
      if (liveOverlaySnapshotTimerRef.current) {
        clearTimeout(liveOverlaySnapshotTimerRef.current);
        liveOverlaySnapshotTimerRef.current = null;
      }
    };
  }, [
    liveOverlaySnapshotReady,
    liveOverlaySnapshotLayout.width,
    liveOverlaySnapshotLayout.height,
    liveOverlaySnapshotSignature,
    shouldPublishGameplayOverlaySnapshot,
    shouldShowCaromSnapshotOverlay,
    shouldPublishWindowsLiveOverlaySnapshot,
    isFullscreen,
  ]);

  const renderOverlay = () => {
    if (
      suppressReactMatchOverlayForNativeLive ||
      thumbnailOverlay.enabled ||
      !shouldShowCameraMatchOverlay
    ) {
      return null;
    }

    return <LiveStreamImagesOverlay />;
  };

  const renderScoreboardOverlay = (
    fullscreenMode = false,
    options?: {liveOutput?: boolean},
  ) => {
  if (suppressReactMatchOverlayForNativeLive) {
    return null;
  }

  const liveOutput = !!options?.liveOutput;
  const poolBottomOffset = 0;
  const caromBottomOffset = liveOutput
    ? LIVE_OVERLAY_CAROM_BOTTOM
    : undefined;

  return (
    <>
      <PoolScoreboardOverlay
        fullscreenMode={fullscreenMode}
        bottomOffset={poolBottomOffset}
        liveOutput={liveOutput}
        liveVideoWidth={LIVE_OVERLAY_SNAPSHOT_WIDTH}
        liveVideoHeight={LIVE_OVERLAY_SNAPSHOT_HEIGHT}
      />
      <CaromScoreboardOverlay
        fullscreenMode={fullscreenMode}
        bottomOffset={caromBottomOffset}
        liveOutput={liveOutput}
        liveVideoWidth={LIVE_OVERLAY_SNAPSHOT_WIDTH}
        liveVideoHeight={LIVE_OVERLAY_SNAPSHOT_HEIGHT}
      />
    </>
  );
};

  const renderCameraScoreboardOverlay = () => {
    // Camera thường không hiện bảng điểm Pool/Carom.
    // Fullscreen và livestream vẫn dùng renderScoreboardOverlay / PoolScoreboardOverlay riêng bên dưới.
    return null;
  };

  const renderThumbnailGroup = (
    imageUris: string[],
    positionStyle: any,
    fullscreenMode: boolean,
    liveOutput = false,
  ) => {
    if (!thumbnailOverlay.enabled || !imageUris?.length) {
      return null;
    }

    return (
      <RNView
        pointerEvents="none"
        style={[
          styles.thumbnailSlot,
          liveOutput && styles.thumbnailSlotLive,
          positionStyle,
        ]}>
        {imageUris.map((uri, index) => (
          <RNImage
            key={`${uri}-${index}`}
            source={{uri}}
            style={[
              styles.thumbnailImage,
              fullscreenMode && styles.thumbnailImageFullscreen,
              liveOutput && styles.thumbnailImageLive,
            ]}
            resizeMode="contain"
          />
        ))}
      </RNView>
    );
  };

  const renderFallbackThumbnail = (fullscreenMode: boolean, liveOutput = false) => {
    const fallbackSource = images.logoFilled || images.logo;
    if (!fallbackSource) {
      return null;
    }

    return (
      <RNView pointerEvents="none" style={styles.thumbnailOverlay}>
        <RNView
          pointerEvents="none"
          style={[
            styles.thumbnailSlot,
            liveOutput && styles.thumbnailSlotLive,
            styles.thumbnailTopLeft,
            liveOutput && styles.thumbnailTopLeftLive,
          ]}>
          <RNImage
            source={fallbackSource}
            style={[
              styles.thumbnailImage,
              fullscreenMode && styles.thumbnailImageFullscreen,
              liveOutput && styles.thumbnailImageLive,
            ]}
            resizeMode="contain"
          />
        </RNView>
      </RNView>
    );
  };

  const renderThumbnailOverlay = (
    fullscreenMode: boolean,
    options?: {skipTopLeft?: boolean; liveOutput?: boolean},
  ) => {
    const liveOutput = !!options?.liveOutput;

    if (
      suppressReactMatchOverlayForNativeLive ||
      !thumbnailOverlay.enabled ||
      !shouldShowCameraMatchOverlay
    ) {
      return null;
    }

    if (!hasThumbnailImages) {
      return options?.skipTopLeft ? null : renderFallbackThumbnail(fullscreenMode, liveOutput);
    }

    return (
      <RNView pointerEvents="none" style={styles.thumbnailOverlay}>
        {options?.skipTopLeft
          ? null
          : renderThumbnailGroup(
              thumbnailOverlay.topLeft,
              [styles.thumbnailTopLeft, liveOutput && styles.thumbnailTopLeftLive],
              fullscreenMode,
              liveOutput,
            )}
        {renderThumbnailGroup(
          thumbnailOverlay.topRight,
          [styles.thumbnailTopRight, liveOutput && styles.thumbnailTopRightLive],
          fullscreenMode,
          liveOutput,
        )}
        {renderThumbnailGroup(
          thumbnailOverlay.bottomLeft,
          [styles.thumbnailBottomLeft, liveOutput && styles.thumbnailBottomLeftLive],
          fullscreenMode,
          liveOutput,
        )}
        {renderThumbnailGroup(
          thumbnailOverlay.bottomRight,
          [styles.thumbnailBottomRight, liveOutput && styles.thumbnailBottomRightLive],
          fullscreenMode,
          liveOutput,
        )}
      </RNView>
    );
  };

  const renderVideoBootstrap = (fullscreenMode: boolean) => (
    useYouTubeNativePreview ? (
      <WindowsOnlyUnusedNativeLivePreview
        controllerRef={youtubeControllerRef}
        mirrorControllerRef={props.cameraRef as any}
        setIsCameraReady={handleCameraReadyChange}
        sourceType={externalLiveLocked ? 'webcam' : effectiveSourceType}
        cameraFacing={effectiveCameraFacing}
        rotatePreview={!externalLiveLocked && effectiveSourceType === 'phone'}
      />
    ) : (
      <Video
        gestureDisabled
        source={viewModel.source}
        initialScale={viewModel.webcam?.scale}
        initialTranslateX={viewModel.webcam?.translateX}
        initialTranslateY={viewModel.webcam?.translateY}
        onFullscreenPlayerDidPresent={
          viewModel.onFullscreenPlayerDidPresent
        }
        onBuffer={viewModel.onBuffer}
        onSeek={viewModel.onSeek}
        onLoad={viewModel.onLoad}
        onVideoTracks={viewModel.onVideoTracks}
        onEnd={viewModel.onEnd}
        onError={viewModel.onWebcamError}
        loadingDisabled
        cameraRef={props.cameraRef}
        isPaused={props.isPaused}
        isStarted={props.isStarted}
        videoUri={props.videoUri}
        webcamType={effectiveSourceType === 'webcam' ? WebcamType.webcam : WebcamType.camera}
        setIsCameraReady={handleCameraReadyChange}
        overlayContent={
          !fullscreenMode && effectiveCameraSource === 'external'
            ? renderOverlay()
            : undefined
        }
        cameraScaleMode={cameraScaleMode}
        suppressCameraFallbackOverlay={false}
        ignoreNavigationFocusLoss={fullscreenMode || props.forceFullscreen === true}
      />
    )
  );

  const renderCameraContent = () => {
    if (isCameraPremiumLocked) {
      return (
        <RNView style={styles.cameraStageRoot}>
          <RNView pointerEvents="none" style={styles.fallbackVisibleStage}>
            {fullLogoPlaceholder}
          </RNView>
        </RNView>
      );
    }

    debugCameraLog('[WebCam] renderCameraContent branch', {
      refreshing: viewModel.refreshing,
      useYouTubeNativePreview,
      effectiveCameraSource,
      effectiveSourceType,
      shouldShowLogoPlaceholder,
      shouldShowOuterLogoOverlay,
      propsIsCameraReady: props.isCameraReady,
      cameraVisualReady,
      effectiveCameraReady,
      streamUri,
      hasStreamUri,
      showLogoOnly,
      finalOutputOwner: 'Video.component',
      finalVisibleLayer: shouldRenderPreview ? 'Video.preview' : 'Video.fallback',
      shouldRenderVideoComponent,
      shouldRenderPreview,
    });

    if (releaseCameraPreviewForFfmpegLive) {
      return (
        <RNView style={styles.cameraStageRoot}>
          <RNView pointerEvents="none" style={styles.fallbackVisibleStage}>
            {fullLogoPlaceholder}
          </RNView>
        </RNView>
      );
    }

    return (
      <RNView style={styles.cameraStageRoot}>
        {shouldRenderVideoComponent ? (
          <RNView
            pointerEvents={shouldRenderPreview ? 'auto' : 'none'}
            style={styles.videoScaleWrap}>
            {renderVideoBootstrap(isFullscreen)}
            {!isFullscreen && effectiveCameraSource !== 'external' ? renderOverlay() : null}
          </RNView>
        ) : null}

        {!shouldRenderPreview && !shouldRenderVideoComponent ? (
          <RNView pointerEvents="none" style={styles.fallbackVisibleStage}>
            {fullLogoPlaceholder}
          </RNView>
        ) : null}
      </RNView>
    );
  };

  const fullscreenChromeOffsets = {
    top: Math.max(18, overlaySafeInsets.top + 8),
    left: Math.max(18, overlaySafeInsets.left + 8),
    right: Math.max(16, overlaySafeInsets.right + 8),
    bottom: Math.max(24, overlaySafeInsets.bottom + 12),
  };
  const fullscreenZoomTrackLength = Math.max(
    adaptive.s(128),
    Math.min(adaptive.height * 0.26, adaptive.s(220)),
  );
  const fullscreenZoomRailHeight = fullscreenZoomTrackLength + adaptive.s(108);
  const fullscreenZoomRailTop = clamp(
    (adaptive.height - fullscreenZoomRailHeight) / 2,
    fullscreenChromeOffsets.top + adaptive.s(54),
    Math.max(
      fullscreenChromeOffsets.top + adaptive.s(54),
      adaptive.height - fullscreenChromeOffsets.bottom - fullscreenZoomRailHeight - adaptive.s(18),
    ),
  );
  const fullscreenScoreboardBottom = 0;

  const renderFullscreenBranding = () => {
  const topLeftLogos =
    thumbnailOverlay.enabled && thumbnailOverlay.topLeft?.length
      ? thumbnailOverlay.topLeft
      : [];
  const fallbackSource = images.logoSmall || images.logoFilled || images.logo;

  if (
    suppressReactMatchOverlayForNativeLive ||
    !shouldShowCameraMatchOverlay ||
    (!topLeftLogos.length && !fallbackSource)
  ) {
    return null;
  }

  return (
    <RNView
      pointerEvents="none"
      style={[
        styles.fullscreenBrandWrap,
        {
          top: fullscreenChromeOffsets.top,
          left: fullscreenChromeOffsets.left,
        },
      ]}>
      {topLeftLogos.length ? (
        topLeftLogos.map((uri, index) => (
          <RNImage
            key={`${uri}-${index}`}
            source={{uri}}
            resizeMode="contain"
            style={styles.fullscreenBrandImage}
          />
        ))
      ) : (
        <RNImage
          source={fallbackSource}
          resizeMode="contain"
          style={styles.fullscreenBrandImage}
        />
      )}
    </RNView>
  );
};

  const renderEmbeddedChrome = () => {
    return (
      <Pressable style={styles.fullscreenFab} onPress={openFullscreen}>
        <Text color={colors.white} fontSize={20}>
          ⛶
        </Text>
      </Pressable>
    );
  };

  const renderFullscreenClose = () => {
    const closeTop = fullscreenChromeOffsets.top + adaptive.s(44);

    return (
      <Pressable
        style={[
          styles.closeButton,
          {
            top: closeTop,
            left: fullscreenChromeOffsets.left,
          },
        ]}
        onPress={closeFullscreen}>
        <Text color={colors.white} fontSize={15}>
          {i18n.t('txtClose')}
        </Text>
      </Pressable>
    );
  };

  const renderFullscreenZoomRail = () => {
    return (
      <RNView
        style={[
          styles.zoomRailVertical,
          {
            top: fullscreenZoomRailTop,
            height: fullscreenZoomRailHeight,
            right: Math.max(overlaySafeInsets.right + adaptive.s(6), adaptive.s(8)),
          },
        ]}>
        <RNView style={styles.currentZoomBadgeVertical}>
          <Text color={colors.white} fontSize={13}>
            {formatZoomLabel(currentZoom)}
          </Text>
        </RNView>

        {sliderZoomSupported ? (
          <>
            <Text color={'rgba(255,255,255,0.82)'} fontSize={12}>
              {formatZoomLabel(sliderMaxZoom)}
            </Text>
            <RNView style={styles.zoomSliderVerticalWrap}>
              <Slider
                style={[
                  styles.zoomSliderVertical,
                  {width: fullscreenZoomTrackLength},
                ]}
                minimumValue={sliderMinZoom}
                maximumValue={sliderMaxZoom}
                value={clamp(currentZoom, sliderMinZoom, sliderMaxZoom)}
                minimumTrackTintColor={'#FFFFFF'}
                maximumTrackTintColor={'rgba(255,255,255,0.28)'}
                thumbTintColor={'#FFFFFF'}
                step={0}
                onValueChange={handleZoomSliderChange}
                onSlidingComplete={handleZoomSliderComplete}
              />
            </RNView>
            <Text color={'rgba(255,255,255,0.82)'} fontSize={12}>
              {formatZoomLabel(sliderMinZoom)}
            </Text>
          </>
        ) : (
          <RNView style={styles.zoomUnsupportedBadgeVertical}>
            <Text color={colors.white} fontSize={11}>
              {i18n.t('cameraZoomUnsupported')}
            </Text>
          </RNView>
        )}
      </RNView>
    );
  };

  const renderFullscreenHud = () => {
    return (
      <RNView pointerEvents="box-none" style={styles.fullscreenHud}>
        {shouldRenderPreview ? renderFullscreenBranding() : null}
        {renderFullscreenClose()}
        <RNView
          pointerEvents="none"
          style={[
            styles.fullscreenScoreboardWrap,
            {
              // Căn giữa bảng điểm Pool theo đúng toàn bộ màn hình.
              // Trước đây right lớn hơn left để né thanh zoom, nên bảng bị lệch.
              left: Math.max(overlaySafeInsets.left, adaptive.s(0)),
              right: Math.max(overlaySafeInsets.right, adaptive.s(0)),
              bottom: 0,
            },
          ]}>
          <PoolScoreboardOverlay
            fullscreenMode
            bottomOffset={fullscreenScoreboardBottom}
          />
        </RNView>
        <CaromScoreboardOverlay fullscreenMode />
        {renderFullscreenZoomRail()}
      </RNView>
    );
  };

  const renderLiveOverlaySnapshotSource = () => {
    if (isCameraPremiumLocked) {
      return null;
    }

    if (
      !ENABLE_YOUTUBE_OVERLAY_SNAPSHOT_CAPTURE ||
      !shouldPublishWindowsLiveOverlaySnapshot ||
      (!shouldShowPoolSnapshotOverlay && !shouldShowCaromSnapshotOverlay)
    ) {
      return null;
    }

    return (
      <RNView
        ref={liveOverlaySnapshotRef}
        collapsable={false}
        pointerEvents="none"
        style={styles.liveOverlaySnapshotSource}
        onLayout={event => {
          const {width, height} = event.nativeEvent.layout;
          setLiveOverlaySnapshotLayout(prev => {
            if (prev.width === width && prev.height === height) {
              return prev;
            }
            console.log(
              `[Live Overlay] desiredSource=gameplay-shared-overlay mounted=${width > 0 && height > 0} size=${width}x${height} snapshotEnabled=true`,
            );
            console.log(
              `[Live Overlay Fullscreen] fullscreen=${isFullscreen} activeSource=offscreen-live-overlay mounted=${width > 0 && height > 0} layout=${width}x${height}`,
            );
            return {width, height};
          });
        }}>
        {renderThumbnailOverlay(false, {liveOutput: true})}
        {renderScoreboardOverlay(false, {liveOutput: true})}
      </RNView>
    );
  };

  const renderCameraView = (fullscreenMode: boolean) => {
    if (isCameraPremiumLocked) {
      return (
        <RNView collapsable={false} style={fullscreenMode ? styles.fullscreenVideoClip : styles.videoClip}>
          {renderCameraContent()}
        </RNView>
      );
    }

    return (
      <RNView
        collapsable={false}
        style={fullscreenMode ? styles.fullscreenVideoClip : styles.videoClip}
        onLayout={event => {
          if (!shouldShowLogoPlaceholder) {
            return;
          }

          debugCameraLog('[WebCam] placeholder surface layout', event.nativeEvent.layout);
        }}>
        {renderCameraContent()}
        {shouldRenderPreview
          ? fullscreenMode
            ? renderThumbnailOverlay(true, {skipTopLeft: true})
            : renderThumbnailOverlay(false)
          : null}
        {!fullscreenMode ? renderCameraScoreboardOverlay() : null}
        {shouldShowOuterLogoOverlay ? (
          <RNView
            pointerEvents="none"
            style={styles.logoOnlyOverlayLogProbe}
            onLayout={() => {
              debugCameraLog('[WebCam] outer logo overlay loaded', {
                source: effectiveCameraSource,
                type: effectiveSourceType,
                effectiveCameraReady,
                shouldShowOuterLogoOverlay,
              });
            }}
          />
        ) : null}
        {!fullscreenMode && shouldRenderPreview ? renderEmbeddedChrome() : null}
      </RNView>
    );
  };

  const content = (
    <RNView
      style={[styles.embeddedRoot, props.forceFullscreen ? styles.fullscreenRoot : null]}
      pointerEvents="box-none">
      {renderLiveOverlaySnapshotSource()}
      <RNView
        style={[styles.videoStageSlot, props.forceFullscreen ? styles.fullscreenStageSlot : null]}
        pointerEvents="box-none"
        onLayout={event => {
          const {width: nextWidth, height: nextHeight} = event.nativeEvent.layout;
          setCameraStageBounds(prev => {
            if (prev.width === nextWidth && prev.height === nextHeight) {
              return prev;
            }

            return {width: nextWidth, height: nextHeight};
          });
        }}>
        <RNView
          collapsable={false}
          style={[
            styles.videoHost,
            styles.videoStageFill,
            props.forceFullscreen ? styles.fullscreenVideoHost : null,
          ]}
          pointerEvents="box-none">
          {renderCameraView(!!props.forceFullscreen)}

          {props.innerControls && !shouldShowLogoPlaceholder && !props.forceFullscreen ? (
            <Pressable
              style={styles.overlayTouch}
              pointerEvents="box-only"
              onPress={viewModel.onToggleInnerControls}
            />
          ) : null}
        </RNView>
      </RNView>

      {props.forceFullscreen && !isCameraPremiumLocked ? renderFullscreenHud() : null}

      {showBottomControls && !shouldShowLogoPlaceholder && !props.forceFullscreen ? (
        <RNView style={styles.bottomBar} pointerEvents="box-none">
          <Pressable
            onPress={() => {
              if (!allowRefresh) {
                return;
              }
              viewModel.onRefresh();
            }}
            style={[
              styles.actionButton,
              !allowRefresh && styles.actionButtonDisabled,
            ]}>
            <Text color={colors.white} fontSize={14}>↻ {i18n.t('refresh')}</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              if (!allowSwitchCamera) {
                return;
              }
              onSwitchCameraPress();
            }}
            style={[
              styles.actionButton,
              styles.switchButton,
              !allowSwitchCamera && styles.actionButtonDisabled,
            ]}>
            <Text color={colors.white} fontSize={14}>⇄ {i18n.t('switchCamera')}</Text>
          </Pressable>

          <Pressable
            onPress={viewModel.onReWatch}
            disabled={!canRewatch}
            style={[
              styles.actionButton,
              !canRewatch && styles.actionButtonDisabled,
            ]}>
            <Text color={colors.white} fontSize={14}>
              ▶ {i18n.t('reWatch')}
            </Text>
          </Pressable>
        </RNView>
      ) : null}
    </RNView>
  );

  return content;
});

const createStyles = (adaptive: any, design: any, rules: any, safeInsets: any) => createGameplayStyles(adaptive, {
  embeddedRoot: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    alignSelf: 'stretch',
    marginTop: 0,
    backgroundColor: colors.black,
  },

  videoStageSlot: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.black,
    position: 'relative',
    zIndex: 10,
    elevation: 10,
  },

  fullscreenStageSlot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    margin: 0,
    padding: 0,
    alignSelf: 'stretch',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },

  fullscreenModalRoot: {
    flex: 1,
    width: '100%',
    height: '100%',
    margin: 0,
    padding: 0,
    backgroundColor: '#000',
    overflow: 'hidden',
  },

  fullscreenRoot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flex: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    margin: 0,
    padding: 0,
    backgroundColor: '#000',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },

  videoHost: {
    flex: 1,
    backgroundColor: '#000',
  },

  videoStage: {
    maxWidth: '100%',
    maxHeight: '100%',
    alignSelf: 'center',
    flexGrow: 0,
    flexShrink: 0,
  },

  videoStageFill: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignSelf: 'stretch',
    minHeight: 0,
  },

  fullscreenVideoHost: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flex: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    margin: 0,
    padding: 0,
    alignSelf: 'stretch',
    backgroundColor: '#000',
    overflow: 'hidden',
  },

  placeholderStageHost: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignSelf: 'stretch',
    minHeight: adaptive.s(96),
  },

  videoClipPlaceholder: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: adaptive.s(96),
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  fullscreenVideoClipPlaceholder: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  videoClip: {
    flex: 1,
    backgroundColor: '#000',
  },

  fullscreenVideoClip: {
    ...StyleSheet.absoluteFillObject,
    flex: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    alignSelf: 'stretch',
    backgroundColor: '#000',
    overflow: 'hidden',
  },

  cameraStageRoot: {
    ...StyleSheet.absoluteFillObject,
    flex: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    alignSelf: 'stretch',
    backgroundColor: '#000',
    overflow: 'hidden',
  },

  videoScaleWrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },

  videoScaleWrapHidden: {
    opacity: 1,
  },

  background: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  fallbackVisibleStage: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },

  logoOnlyBackground: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },

  logoOnlyImage: {
    width: '62%',
    height: '32%',
    alignSelf: 'center',
  },

  logoOnlyOverlayLogProbe: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },

  fullWidth: {
    width: '100%',
  },

  liveOverlaySnapshotSource: {
    position: 'absolute',
    // v59: keep the React fullscreen overlay snapshot source INSIDE the visible
    // XAML tree. RenderTargetBitmap on RNW can return blank/empty when the target
    // view is parked far offscreen or behind a negative z-index. The camera stage
    // is rendered above this hidden source, so users do not see a duplicate overlay,
    // but native capture can still render the exact React fullscreen overlay.
    left: 0,
    top: 0,
    width: LIVE_OVERLAY_SNAPSHOT_WIDTH,
    height: LIVE_OVERLAY_SNAPSHOT_HEIGHT,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    zIndex: 0,
    elevation: 0,
  },

  thumbnailOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 46,
    elevation: 46,
  },

  thumbnailSlot: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'flex-start',
    maxWidth: '42%',
  },

  thumbnailSlotLive: {
    maxWidth: '38%',
  },

  thumbnailTopLeft: {
    top: 10,
    left: 10,
  },

  thumbnailTopLeftLive: {
    top: LIVE_OVERLAY_LOGO_MARGIN_TOP,
    left: LIVE_OVERLAY_LOGO_MARGIN_X,
  },

  thumbnailTopRight: {
    top: 10,
    right: 10,
    justifyContent: 'flex-end',
  },

  thumbnailTopRightLive: {
    top: LIVE_OVERLAY_LOGO_MARGIN_TOP,
    right: LIVE_OVERLAY_LOGO_MARGIN_X,
    justifyContent: 'flex-end',
  },

  thumbnailBottomLeft: {
    bottom: 10,
    left: 10,
  },

  thumbnailBottomLeftLive: {
    bottom: LIVE_OVERLAY_LOGO_MARGIN_BOTTOM,
    left: LIVE_OVERLAY_LOGO_MARGIN_X,
  },

  thumbnailBottomRight: {
    bottom: 10,
    right: 10,
    justifyContent: 'flex-end',
  },

  thumbnailBottomRightLive: {
    bottom: LIVE_OVERLAY_LOGO_MARGIN_BOTTOM,
    right: LIVE_OVERLAY_LOGO_MARGIN_X,
    justifyContent: 'flex-end',
  },

  thumbnailImage: {
    width: adaptive.s(92),
    height: adaptive.s(52),
    marginRight: 8,
  },

  thumbnailImageFullscreen: {
    width: adaptive.s(150),
    height: adaptive.s(84),
    marginRight: 10,
  },

  thumbnailImageLive: {
    width: LIVE_OVERLAY_LOGO_WIDTH,
    height: LIVE_OVERLAY_LOGO_HEIGHT,
    marginRight: 14,
  },

  fullscreenHud: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    pointerEvents: 'box-none',
  },

  fullscreenScoreboardWrap: {
    position: 'absolute',
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 10000,
    elevation: 10000,
  },

  fullscreenBrandWrap: {
    position: 'absolute',
    zIndex: 10001,
    elevation: 10001,
    pointerEvents: 'none',
    backgroundColor: 'transparent',
    borderRadius: 0,
    borderWidth: 0,
    borderColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
    margin: 0,
    shadowOpacity: 0,
  },

  fullscreenBrandImage: {
    width: adaptive.s(126),
    height: adaptive.s(42),
    tintColor: '#FFFFFF',
  },

  fullscreenFab: {
    position: 'absolute',
    top: Math.max(10, rules.camera.overlayInset),
    right: Math.max(10, rules.camera.overlayInset),
    width: adaptive.s(42),
    height: adaptive.s(42),
    borderRadius: adaptive.s(21),
    backgroundColor: 'rgba(0,0,0,0.76)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
    elevation: 60,
  },

  closeButton: {
    position: 'absolute',
    top: Math.max(rules.camera.overlayInset + safeInsets.top, adaptive.s(18)),
    left: Math.max(rules.camera.overlayInset + safeInsets.left, adaptive.s(18)),
    paddingHorizontal: adaptive.s(16),
    paddingVertical: adaptive.s(10),
    borderRadius: adaptive.s(22),
    backgroundColor: 'rgba(0,0,0,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    zIndex: 10002,
    elevation: 10002,
  },

  zoomRail: {
    position: 'absolute',
    left: Math.max(rules.camera.overlayInset + safeInsets.left, adaptive.s(18)),
    right: Math.max(rules.camera.overlayInset + safeInsets.right, adaptive.s(18)),
    bottom: Math.max(safeInsets.bottom + adaptive.s(24), adaptive.s(24)),
    minHeight: adaptive.s(84),
    borderRadius: adaptive.s(22),
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: adaptive.s(16),
    paddingVertical: adaptive.s(12),
    justifyContent: 'center',
    zIndex: 42,
    elevation: 42,
  },

  zoomRailVertical: {
    position: 'absolute',
    width: adaptive.s(56),
    borderRadius: adaptive.s(28),
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
    paddingVertical: adaptive.s(14),
    paddingHorizontal: adaptive.s(6),
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10003,
    elevation: 10003,
  },

  zoomSliderVerticalWrap: {
    flex: 1,
    width: adaptive.s(40),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: adaptive.s(160),
  },

  zoomSliderVertical: {
    height: adaptive.s(40),
    transform: [{rotate: '-90deg'}],
  },

  currentZoomBadgeVertical: {
    minWidth: adaptive.s(44),
    paddingVertical: adaptive.s(6),
    paddingHorizontal: adaptive.s(6),
    borderRadius: rules.camera.cardRadius,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    marginBottom: adaptive.s(8),
  },

  zoomUnsupportedBadgeVertical: {
    paddingVertical: adaptive.s(8),
    paddingHorizontal: adaptive.s(6),
    borderRadius: rules.camera.cardRadius,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
  },

  zoomHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },

  zoomSlider: {
    width: '100%',
    height: 36,
  },

  zoomRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },

  currentZoomBadge: {
    minWidth: 44,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: rules.camera.cardRadius,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
  },

  zoomUnsupportedBadge: {
    width: 44,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: rules.camera.cardRadius,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
  },

  zoomStepButton: {
    minWidth: 38,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: rules.camera.cardRadius,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
  },

  zoomStepButtonActive: {
    backgroundColor: '#ffffff',
  },

  bottomBar: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 10,
    position: 'relative',
    zIndex: 50,
    elevation: 50,
  },

  actionButton: {
    flex: 1,
    minHeight: rules.controlHeights.compact,
    borderRadius: design.radius.md,
    backgroundColor: '#1f1f1f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },

  switchButton: {
    backgroundColor: '#9d1010',
  },

  actionButtonDisabled: {
    opacity: 0.45,
  },

  overlayTouch: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
});

export default memo(WebCam);
