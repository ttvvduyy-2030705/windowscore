type SourceType = 'phone' | 'webcam';

export type YouTubeNativeOverlayPlayer = {
  name?: string;
  flag?: string;
  score?: number;
  currentPoint?: number;
};

export type YouTubeNativeOverlayThumbnails = {
  enabled?: boolean;
  topLeft?: string[];
  topRight?: string[];
  bottomLeft?: string[];
  bottomRight?: string[];
};

export type YouTubeNativeOverlayPayload = {
  visible?: boolean;
  variant?: 'pool' | 'carom';
  source?: 'gameplay-shared-overlay-snapshot' | string;
  snapshotUri?: string;
  snapshotWidth?: number;
  snapshotHeight?: number;
  updatedAt?: number;
  currentPlayerIndex?: number;
  countdownTime?: number;
  baseCountdown?: number;
  goal?: number;
  totalTurns?: number;
  players?: YouTubeNativeOverlayPlayer[];
  thumbnails?: YouTubeNativeOverlayThumbnails;
};

type StartOptions = {
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  audioBitrate?: number;
  sampleRate?: number;
  isStereo?: boolean;
  cameraFacing?: 'front' | 'back';
  sourceType?: SourceType;
  rotationDegrees?: number;
};

export const isYouTubeNativeLiveEngineMounted = () => false;

export const isYouTubeNativePreviewViewAvailable = () => false;

export const isYouTubeNativeLiveReady = () => false;

export const prepareYouTubeNativePreview = async (
  _cameraFacing: 'front' | 'back' = 'back',
  _sourceType: SourceType = 'phone',
) => {
  console.log('[Windows YouTube Live] prepare preview skipped');
  return false;
};

export const startYouTubeNativeLive = async (
  _url: string,
  _options: StartOptions = {},
) => {
  console.log('[Windows YouTube Live] native live disabled on Windows');
  return false;
};

export const stopYouTubeNativeLive = async () => {
  return false;
};

export const startYouTubeNativeRecord = async (_path: string) => {
  console.log('[Windows YouTube Live] native recording disabled on Windows');
  return false;
};

export const stopYouTubeNativeRecord = async (): Promise<string | null> => {
  return null;
};

export const updateYouTubeNativeOverlay = async (
  payload: YouTubeNativeOverlayPayload,
) => {
  console.log('[Windows Live Overlay] skipped', {
    visible: !!payload?.visible,
    mode: payload?.variant || 'unknown',
    hasSnapshot: Boolean(payload?.snapshotUri),
  });

  return false;
};

export const switchYouTubeNativeCamera = async () => {
  return false;
};

export const getYouTubeNativeZoomInfo = async () => {
  return {
    supported: false,
    minZoom: 1,
    maxZoom: 1,
    zoom: 1,
    source: 'windows',
  };
};

export const setYouTubeNativeZoom = async (_level: number) => {
  return 1;
};

export const subscribeYouTubeNativeLiveState = (
  _listener: (event: {type?: string; message?: string}) => void,
) => {
  return () => undefined;
};

export default {
  isYouTubeNativeLiveEngineMounted,
  isYouTubeNativePreviewViewAvailable,
  isYouTubeNativeLiveReady,
  prepareYouTubeNativePreview,
  startYouTubeNativeLive,
  stopYouTubeNativeLive,
  startYouTubeNativeRecord,
  stopYouTubeNativeRecord,
  updateYouTubeNativeOverlay,
  switchYouTubeNativeCamera,
  getYouTubeNativeZoomInfo,
  setYouTubeNativeZoom,
  subscribeYouTubeNativeLiveState,
};