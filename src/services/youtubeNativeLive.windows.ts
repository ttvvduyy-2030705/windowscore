import RNFS from 'react-native-fs';
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


const normalizePath = (value?: string | null) => String(value || '').replace(/\\/g, '/');
const getNativeLiveOverlayRootDir = () =>
  normalizePath(`${RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath || RNFS.DocumentDirectoryPath}/AplusScoreLiveOverlay`);
const getWindowsLiveOverlayPaths = () => {
  const nativeRoot = getNativeLiveOverlayRootDir();
  return {
    nativeRoot,
    nativeSnapshotPath: `${nativeRoot}/overlay-snapshot.png`,
    nativeReactSnapshotPath: `${nativeRoot}/react-fullscreen-overlay.png`,
    nativeSnapshotMetaPath: `${nativeRoot}/overlay-snapshot.json`,
  };
};

const safeUnlink = async (path?: string) => {
  const target = String(path || '').trim();
  if (!target) {
    return;
  }
  try {
    if (await RNFS.exists(target)) {
      await RNFS.unlink(target);
    }
  } catch (_error) {}
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
  const paths = getWindowsLiveOverlayPaths();
  try {
    await RNFS.mkdir(paths.nativeRoot);
  } catch (_error) {}

  try {
    const visible = !!payload?.visible;
    const sourceUri = String(payload?.snapshotUri || '').trim();
    const normalizedSource = sourceUri
      .replace(/^file:\/\//i, '')
      .replace(/\\/g, '/')
      .replace(/\/+$/g, '');
    const hasSnapshot = visible && /\.png$/i.test(normalizedSource);
    const sourceDir = hasSnapshot
      ? normalizedSource.replace(/\/[^/]+$/g, '')
      : '';
    const sourceMetaPath = sourceDir ? `${sourceDir}/overlay-snapshot.json` : '';

    // v62: keep the captured fullscreen overlay PNG in its original TempState
    // folder and write metadata next to it. v60 could treat a trailing slash as
    // a directory and attempted to write react-fullscreen-overlay.png/overlay-snapshot.json.
    const meta = {
      visible: hasSnapshot,
      variant: payload?.variant || 'pool',
      source: payload?.source || 'gameplay-shared-overlay-snapshot',
      snapshotPath: hasSnapshot ? normalizedSource : '',
      snapshotWidth: Number(payload?.snapshotWidth || 0),
      snapshotHeight: Number(payload?.snapshotHeight || 0),
      updatedAt: Number(payload?.updatedAt || Date.now()),
    };
    const metaJson = JSON.stringify(meta, null, 2);

    if (sourceMetaPath) {
      await RNFS.writeFile(sourceMetaPath, metaJson, 'utf8');
    }

    try {
      await RNFS.writeFile(paths.nativeSnapshotMetaPath, metaJson, 'utf8');
    } catch (mirrorError) {
      console.log('[Windows Live Overlay] mirror meta write skipped', {
        nativeSnapshotMetaPath: paths.nativeSnapshotMetaPath,
        error: mirrorError,
      });
    }

    if (!hasSnapshot) {
      await safeUnlink(paths.nativeSnapshotPath);
      await safeUnlink(paths.nativeReactSnapshotPath);
    }

    console.log('[Windows Live Overlay]', {
      visible: hasSnapshot,
      mode: payload?.variant || 'unknown',
      hasSnapshot,
      nativeSnapshotPath: hasSnapshot ? normalizedSource : '',
      nativeSnapshotMetaPath: sourceMetaPath || paths.nativeSnapshotMetaPath,
      copyMode: 'direct-tempstate-path-v62',
    });

    return true;
  } catch (error) {
    console.log('[Windows Live Overlay] failed', {
      visible: !!payload?.visible,
      mode: payload?.variant || 'unknown',
      hasSnapshot: Boolean(payload?.snapshotUri),
      error,
    });
    return false;
  }
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