import {NativeModules, Platform} from 'react-native';
import RNFS from 'react-native-fs';
import {Bitrate, Fps, Resolution} from 'types/webcam';
import i18n from 'i18n';

export const WINDOWS_FFMPEG_CONFIG_STORAGE_KEY = '@APLUS_WINDOWS_FFMPEG_LIVE_CONFIG_V1';
export const DEFAULT_YOUTUBE_RTMP_URL = 'rtmps://a.rtmps.youtube.com/live2';

export type WindowsFfmpegLiveState = 'stopped' | 'starting' | 'live' | 'stopping' | 'error';

export type WindowsFfmpegLiveConfig = {
  platform?: 'youtube';
  rtmpUrl: string;
  streamKey: string;
  ffmpegPath?: string;
  cameraDeviceName?: string;
  audioDeviceName?: string;
  useAudio?: boolean;
  audioInputMode?: 'silent' | 'anullsrc' | 'dshow' | 'dshow-default' | 'dshow-video';
  width?: number;
  height?: number;
  resolution?: Resolution | string;
  fps?: Fps | string | number;
  bitrate?: Bitrate | string;
  overlayMode?: 'png' | 'drawtext' | 'none';
  /**
   * auto = production-safe mode. For app stability this build uses libx264 only.
   * Hardware encoders are intentionally skipped because some FFmpeg/GPU driver
   * combinations crash immediately and can destabilize the RNW gameplay app.
   */
  videoEncoder?: 'auto' | 'h264_nvenc' | 'h264_amf' | 'h264_qsv' | 'libx264';
  directShowInputMode?: 'default' | 'mjpeg720' | 'mjpeg1080' | 'yuyv720';
};

export type WindowsFfmpegOverlaySnapshot = {
  category?: string;
  mode?: string;
  currentPlayerIndex?: number;
  countdownTime?: number;
  warmUpCountdownTime?: number;
  gameBreakEnabled?: boolean;
  totalTurns?: number;
  goal?: number;
  players?: Array<{
    name?: string;
    flag?: string;
    score?: number;
    currentPoint?: number;
    highestRate?: number;
    secondHighestRate?: number;
    average?: number;
  }>;
};

type NativeWindowsFfmpegLiveModule = {
  checkFfmpegAvailable?: (ffmpegPath?: string) => Promise<{
    available?: boolean;
    ffmpegPath?: string;
    version?: string;
    error?: string;
  }>;
  listDevices?: (ffmpegPath?: string) => Promise<{
    videoDevices?: string[];
    audioDevices?: string[];
    ffmpegPath?: string;
    error?: string;
    outputPreview?: string;
    rawOutput?: string;
  }>;
  start?: (payload: {
    ffmpegPath?: string;
    args: string[];
    commandMasked: string;
  }) => Promise<{
    pid?: number;
    status?: string;
    exitCode?: number;
    error?: string;
    alreadyRunning?: boolean;
  }>;
  stop?: () => Promise<{
    stopped?: boolean;
    exitCode?: number;
    error?: string;
  }>;
  status?: () => Promise<{
    status?: WindowsFfmpegLiveState;
    pid?: number;
    stderrSummary?: string;
    error?: string;
  }>;
  releaseCameraForExternalUse?: () => Promise<boolean | {released?: boolean; ok?: boolean}>;
};

let liveState: WindowsFfmpegLiveState = 'stopped';
let currentConfig: WindowsFfmpegLiveConfig | null = null;
let lastOverlayPath = '';
let auditLogged = false;
let lastOverlayWriteSignature = '';
let lastOverlayWriteAt = 0;
let lastOverlayLogAt = 0;

const SCREEN_CAPTURE_SENTINEL = '__APLUS_SCREEN_CAPTURE__';
const DESKTOP_CAPTURE_LABEL = 'desktop-gdigrab-live-capture';

const isScreenCaptureSentinel = (value?: string | null) =>
  String(value || '').trim() === SCREEN_CAPTURE_SENTINEL;

const getNativeModule = (): NativeWindowsFfmpegLiveModule | null => {
  const modules = NativeModules as any;
  return modules?.WindowsFfmpegLiveModule || null;
};

const normalizePath = (value?: string | null) => String(value || '').replace(/\\/g, '/');

const quoteArg = (value: string) => {
  const safeValue = String(value || '');
  if (!safeValue) {
    return '""';
  }
  return `"${safeValue.replace(/"/g, '\\"')}"`;
};

const toFfmpegSafeText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ._\-+/]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const escapeDrawText = (value: string) =>
  toFfmpegSafeText(value)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\r?\n/g, ' ');


const uniqueValues = (values: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  return values
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter(value => {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};



const buildLikelyMicrophoneDeviceNames = (cameraDeviceName?: string | null) => {
  const cameraName = String(cameraDeviceName || '').trim();
  const candidates: Array<string | undefined> = [];

  if (cameraName) {
    // Some Windows webcams expose the audio device as
    //   Microphone (<camera name>-Audio)
    // while the video device itself is just <camera name>.
    // This is the exact pattern shown by the user's FFmpeg device check:
    //   video: 2K Web Camera
    //   audio: Microphone (2K Web Camera-Audio)
    candidates.push(`Microphone (${cameraName}-Audio)`);
    candidates.push(`Microphone (${cameraName})`);
    candidates.push(`${cameraName}-Audio`);
  }

  candidates.push(
    'Microphone (2K Web Camera-Audio)',
    'Microphone (Realtek(R) Audio)',
    'Microphone Array (Realtek(R) Audio)',
  );

  return uniqueValues(candidates);
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getStartupFailureSummary = (status: any) =>
  String(status?.stderrSummary || status?.error || '').trim();

const looksLikeEarlyFfmpegFailure = (status: any) => {
  const normalizedStatus = String(status?.status || '').toLowerCase();
  const summary = getStartupFailureSummary(status).toLowerCase();
  return (
    normalizedStatus === 'stopped' ||
    normalizedStatus === 'error' ||
    summary.includes('error opening input') ||
    summary.includes('could not find video device') ||
    summary.includes('unable to bindtoobject') ||
    summary.includes('i/o error') ||
    summary.includes('connection refused') ||
    summary.includes('server returned') ||
    summary.includes('failed to update header')
  );
};

const normalizeWindowsExecutablePath = (value?: string | null) =>
  String(value || '').trim().replace(/\//g, '\\');

const normalizeNativeFfmpegPath = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw || raw === 'PATH:ffmpeg') {
    return '';
  }

  const normalized = normalizeWindowsExecutablePath(raw);
  const lower = normalized.toLowerCase();

  // v41 camera-only fix: do not reuse FFmpeg paths that live inside the
  // RNW/MSIX AppX package or package-private AC folder. The user's logs show
  // these copies can list DirectShow devices but fail when they actually bind
  // the webcam. Passing an empty path makes the native module resolve/copy
  // FFmpeg into the real desktop user's LocalAppData first.
  const isPackagedOrBuildAsset =
    lower.includes('\\appx\\assets\\ffmpeg\\') ||
    (lower.includes('\\windows\\x64\\') && lower.includes('\\appx\\assets\\ffmpeg\\')) ||
    lower.includes('\\appdata\\local\\packages\\') ||
    lower.includes('\\ac\\aplusscore\\ffmpeg\\');

  if (isPackagedOrBuildAsset) {
    return '';
  }

  return normalized;
};

const resolveUsableFfmpegPath = async (
  nativeModule: NativeWindowsFfmpegLiveModule | null,
  preferredPath?: string,
) => {
  // Source of truth is the native C++ module. JS/RNFS cannot reliably see
  // C:\ffmpeg, WinGet Links, or packaged Assets from the UWP/RNW sandbox.
  // Let C++ resolve: bundled Assets\ffmpeg\ffmpeg.exe -> C:\ffmpeg\bin -> PATH.
  const candidates = uniqueValues([
    normalizeNativeFfmpegPath(preferredPath),
    '',
  ]);

  if (!nativeModule?.checkFfmpegAvailable) {
    return normalizeNativeFfmpegPath(preferredPath);
  }

  for (const candidate of candidates) {
    try {
      const result = await nativeModule.checkFfmpegAvailable(candidate);
      const resolved = normalizeNativeFfmpegPath(result?.ffmpegPath || candidate);
      console.log('[LiveFfmpegResolve]', {
        requested: candidate || 'AUTO_NATIVE',
        resolved: resolved || result?.ffmpegPath || '',
        usable: !!result?.available,
        error: result?.error,
      });
      if (result?.available) {
        return resolved || candidate;
      }
    } catch (error: any) {
      console.log('[LiveFfmpegResolve]', {
        requested: candidate || 'AUTO_NATIVE',
        usable: false,
        error: error?.message || String(error),
      });
    }
  }

  return normalizeNativeFfmpegPath(preferredPath);
};

export const maskStreamKey = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.length <= 8) {
    return `${raw.slice(0, 2)}****`;
  }
  return `${raw.slice(0, 4)}-****-${raw.slice(-4)}`;
};

const normalizeRtmpOutput = (rtmpUrl: string, streamKey: string) => {
  const cleanUrl = String(rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL).trim().replace(/\/+$/g, '');
  const cleanKey = String(streamKey || '').trim();
  return `${cleanUrl}/${cleanKey}`;
};

const resolveDimensions = (config: WindowsFfmpegLiveConfig) => {
  if (config.width && config.height) {
    return {width: config.width, height: config.height};
  }

  if (config.resolution === Resolution.HD || config.resolution === '720p') {
    return {width: 1280, height: 720};
  }

  // QUALITY/LOW-DELAY v3: return to 1080p output after backend ultraLow is verified.
  // The previous 720p/2800k build reduced startup buffering but made the live image
  // look soft. 1080p with a small VBV buffer keeps delay low while preserving detail.
  return {width: 1920, height: 1080};
};

const resolveFps = (config: WindowsFfmpegLiveConfig) => {
  const fps = Number(config.fps || Fps.F30);
  return Number.isFinite(fps) && fps > 0 ? Math.min(30, Math.max(10, fps)) : 15;
};

const resolveBitrate = (config: WindowsFfmpegLiveConfig) => {
  const raw = String(config.bitrate || '4500k').trim();
  const numeric = /^\d+k$/i.test(raw)
    ? Number(raw.replace(/k$/i, ''))
    : Number(raw.replace(/[^\d.]/g, ''));
  if (Number.isFinite(numeric) && numeric > 0) {
    return `${Math.round(Math.min(7000, Math.max(2500, numeric)))}k`;
  }
  return '5200k';
};

const resolveVideoEncoder = (config: WindowsFfmpegLiveConfig) =>
  (String(config.videoEncoder || 'auto').trim() || 'auto') as NonNullable<WindowsFfmpegLiveConfig['videoEncoder']>;

const resolveDirectShowInputMode = (config: WindowsFfmpegLiveConfig) =>
  (String(config.directShowInputMode || 'default').trim() || 'default') as NonNullable<WindowsFfmpegLiveConfig['directShowInputMode']>;

const buildDirectShowInputModeCandidates = (preferred?: WindowsFfmpegLiveConfig['directShowInputMode']) => {
  // QUALITY/LOW-DELAY v3:
  // The low-delay 720p build opened DirectShow in default mode, which often gives
  // only a soft 640x480 raw camera feed. Prefer the webcam's 1080p MJPEG mode for
  // a sharper YouTube picture, but keep the old default mode as a safe fallback so
  // live still starts if a camera does not support MJPEG 1080p.
  const candidates: Array<NonNullable<WindowsFfmpegLiveConfig['directShowInputMode']>> = [
    preferred || 'mjpeg1080',
    'mjpeg1080',
    'default',
  ];
  return uniqueValues(candidates) as Array<NonNullable<WindowsFfmpegLiveConfig['directShowInputMode']>>;
};

const buildEncoderCandidates = (_encoder?: WindowsFfmpegLiveConfig['videoEncoder']) => {
  // CRASH-FIX v10: use one stable encoder only.
  // The log showed h264_nvenc exiting with 3221225477 (0xC0000005 access violation).
  // Retrying hardware encoders from inside the app makes the gameplay process unstable.
  // libx264 1080p30 with ultrafast preset keeps the stream inside the app but lowers CPU spikes.
  return ['libx264'] as Array<NonNullable<WindowsFfmpegLiveConfig['videoEncoder']>>;
};

const buildVideoEncoderArgs = (
  encoder: NonNullable<WindowsFfmpegLiveConfig['videoEncoder']>,
) => {
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-rc', 'cbr'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cbr'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'veryfast'];
    case 'libx264':
    default:
      return ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-threads', '2'];
  }
};

const getLiveRootDir = () => normalizePath(`${RNFS.ExternalDirectoryPath || RNFS.DocumentDirectoryPath}/LiveOverlay`);
const getNativeLiveOverlayRootDir = () =>
  normalizePath(`${RNFS.TemporaryDirectoryPath || RNFS.CachesDirectoryPath || RNFS.DocumentDirectoryPath}/AplusScoreLiveOverlay`);

export const getWindowsLiveOverlayPaths = () => {
  const root = getLiveRootDir();
  const nativeRoot = getNativeLiveOverlayRootDir();
  return {
    root,
    nativeRoot,
    jsonPath: `${root}/overlay.json`,
    nativeJsonPath: `${nativeRoot}/overlay.json`,
    htmlPath: `${root}/overlay.html`,
    pngPath: `${root}/overlay.png`,
    nativeSnapshotMetaPath: `${nativeRoot}/overlay-snapshot.json`,
    nativeSnapshotPath: `${nativeRoot}/overlay-snapshot.png`,
    nativeReactSnapshotPath: `${nativeRoot}/react-fullscreen-overlay.png`,
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

export const resetWindowsFfmpegOverlaySession = async (reason = 'new-live-session') => {
  const paths = getWindowsLiveOverlayPaths();
  lastOverlayWriteSignature = '';
  lastOverlayWriteAt = 0;
  lastOverlayLogAt = 0;
  lastOverlayPath = '';

  try {
    await RNFS.mkdir(paths.root);
  } catch (_error) {}
  try {
    await RNFS.mkdir(paths.nativeRoot);
  } catch (_error) {}

  const hiddenPayload = JSON.stringify(
    {
      visible: false,
      source: 'aplus-live-overlay-reset',
      reason,
      updatedAt: Date.now(),
    },
    null,
    2,
  );

  try {
    await RNFS.writeFile(paths.nativeSnapshotMetaPath, hiddenPayload, 'utf8');
  } catch (_error) {}
  try {
    await RNFS.writeFile(paths.nativeJsonPath, hiddenPayload, 'utf8');
  } catch (_error) {}
  try {
    await RNFS.writeFile(paths.jsonPath, hiddenPayload, 'utf8');
  } catch (_error) {}

  await safeUnlink(paths.nativeSnapshotPath);
  await safeUnlink(paths.nativeReactSnapshotPath);
  await safeUnlink(paths.pngPath);

  console.log('[WindowsLiveOverlayReset]', {
    reason,
    nativeSnapshotMetaPath: paths.nativeSnapshotMetaPath,
    nativeOverlayPath: paths.nativeJsonPath,
    overlayPath: paths.jsonPath,
  });

  return true;
};

const isCaromSnapshot = (snapshot?: WindowsFfmpegOverlaySnapshot | null) => {
  const category = String(snapshot?.category || '').toLowerCase();
  const mode = String(snapshot?.mode || '').toLowerCase();
  return category.includes('carom') || mode.includes('carom') || mode.includes('libre');
};

const normalizePlayer = (snapshot: WindowsFfmpegOverlaySnapshot | null | undefined, index: number) => {
  const player = snapshot?.players?.[index] || {};
  return {
    name: String(player.name || `Player ${index + 1}`).trim() || `Player ${index + 1}`,
    flag: String(player.flag || '').trim(),
    score: Number(player.score || 0),
    currentPoint: Number(player.currentPoint || 0),
    highestRate: Number(player.highestRate || 0),
    secondHighestRate: Number(player.secondHighestRate || 0),
    average: Number(player.average || 0),
  };
};

const buildOverlayParity = (snapshot?: WindowsFfmpegOverlaySnapshot | null) => {
  const players = snapshot?.players || [];
  const hasPlayers = players.length >= 2;
  const hasFlags = players.slice(0, 2).some(player => Boolean(String(player?.flag || '').trim()));
  const hasTimer = snapshot?.countdownTime !== undefined && snapshot?.countdownTime !== null;
  const hasTarget = snapshot?.goal !== undefined && snapshot?.goal !== null;
  const hasTurn = snapshot?.totalTurns !== undefined && snapshot?.totalTurns !== null;
  const hasCaromStats = isCaromSnapshot(snapshot)
    ? players.slice(0, 2).some(player =>
        Number(player?.currentPoint || 0) !== 0 ||
        Number(player?.highestRate || 0) !== 0 ||
        Number(player?.secondHighestRate || 0) !== 0 ||
        Number(player?.average || 0) !== 0,
      )
    : true;

  const missingFields = [
    hasPlayers ? '' : 'players',
    hasTimer ? '' : 'timer',
    hasTarget ? '' : 'target',
    hasTurn ? '' : 'turn',
    hasCaromStats ? '' : 'caromStats',
  ].filter(Boolean);

  return {
    logo: true,
    scoreboard: hasPlayers,
    timer: hasTimer,
    players: hasPlayers,
    flags: hasFlags,
    target: hasTarget,
    turn: hasTurn,
    mode: isCaromSnapshot(snapshot) ? 'carom' : 'pool',
    windowsOverlayStatus: missingFields.length ? 'partial' : 'same-data-source',
    missingFields,
  };
};

const logLiveAuditOnce = () => {
  if (auditLogged) {
    return;
  }
  auditLogged = true;

  console.log('[WindowsLiveAudit]', {
    files: [
      'src/services/livestream/WindowsFfmpegLiveEngine.ts',
      'windows/billiardsgrade/WindowsFfmpegLiveModule.cpp',
      'src/scenes/game/game-play/GamePlayViewModel.tsx',
      'src/services/youtubeLiveFlow.ts',
    ],
    engine: 'Windows local FFmpeg camera-only DirectShow ingest + YouTube RTMP',
    overlaySource: 'gameplay playerSettings/gameSettings/countdown snapshot written to overlay.json/html; FFmpeg stream uses no drawtext for crash safety',
    startFlow: 'OAuth/backend session -> FFmpeg local start',
    stopFlow: 'send q to FFmpeg, wait, terminate fallback, backend stop',
    usesNgrok: false,
    usesMetro: false,
    usesFfmpeg: true,
  });

  [
    ['Live entry screen', 'Windows live-platform -> live-platform-setup -> gameplay', 'kept'],
    ['Auth / stream key', 'OAuth/backend returns RTMP ingest for Windows FFmpeg', 'kept'],
    ['Camera source', 'DirectShow camera-only live; force unmount MediaCapture before YouTube create; desktop capture disabled', 'kept'],
    ['Overlay source of truth', 'gameplay playerSettings/gameSettings snapshot', 'kept'],
    ['Overlay rendering', 'JSON/HTML overlay artifact only; FFmpeg drawtext disabled to stop 0xC0000005 crashes', 'changed'],
    ['Release dependency', 'no Metro/ngrok for stream', 'kept'],
  ].forEach(([item, windowsValue, status]) => {
    console.log('[WindowsLiveDiff]', {item, windowsValue, status});
  });
};

export const getWindowsFfmpegLiveStatus = async () => {
  const nativeModule = getNativeModule();
  if (nativeModule?.status) {
    try {
      const status = await nativeModule.status();
      liveState = (status.status || liveState) as WindowsFfmpegLiveState;
      return status;
    } catch (error: any) {
      return {status: liveState, error: error?.message || String(error)};
    }
  }

  return {
    status: liveState,
    error:
      Platform.OS === 'windows'
        ? i18n.t('ffmpegModuleMissing') as string
        : i18n.t('ffmpegWindowsOnly') as string,
  };
};

export const checkFfmpegAvailable = async (ffmpegPath?: string) => {
  const nativeModule = getNativeModule();

  console.log('[LiveFfmpegCheck]', {
    ffmpegPath: ffmpegPath || 'AUTO_NATIVE',
    available: Boolean(nativeModule?.checkFfmpegAvailable),
    version: undefined,
    error: nativeModule?.checkFfmpegAvailable
      ? undefined
      : 'WindowsFfmpegLiveModule missing',
  });

  if (!nativeModule?.checkFfmpegAvailable) {
    return {
      available: false,
      ffmpegPath: normalizeNativeFfmpegPath(ffmpegPath),
      version: '',
      error: i18n.t('ffmpegModuleMissing') as string,
    };
  }

  const resolvedFfmpegPath = await resolveUsableFfmpegPath(nativeModule, ffmpegPath);

  try {
    const result = await nativeModule.checkFfmpegAvailable(resolvedFfmpegPath || '');
    const finalPath = normalizeNativeFfmpegPath(result?.ffmpegPath || resolvedFfmpegPath || ffmpegPath);
    console.log('[LiveFfmpegCheck]', {
      ffmpegPath: finalPath || result?.ffmpegPath || 'AUTO_NATIVE',
      available: !!result?.available,
      version: result?.version,
      error: result?.error,
    });
    return {
      ...result,
      ffmpegPath: finalPath,
    };
  } catch (error: any) {
    console.log('[LiveFfmpegCheck]', {
      ffmpegPath: resolvedFfmpegPath || ffmpegPath || 'AUTO_NATIVE',
      available: false,
      version: undefined,
      error: error?.message || String(error),
    });
    return {
      available: false,
      ffmpegPath: resolvedFfmpegPath || normalizeNativeFfmpegPath(ffmpegPath),
      error: error?.message || String(error),
    };
  }
};


const parseFirstDirectShowVideoDeviceFromText = (text?: string): string => {
  const value = String(text || '');
  const lines = value.split(/\r?\n/g);
  for (const line of lines) {
    const match = line.match(/"([^"]+)"/);
    if (!match?.[1]) {
      continue;
    }
    const name = match[1].trim();
    const lower = name.toLowerCase();
    if (!name || lower.startsWith('@device')) {
      continue;
    }
    // FFmpeg 8.x can print the DirectShow webcam as "2K Web Camera" (none)
    // when called from the packaged RNW process. The native parser previously
    // ignored it because it expected the suffix to be "(video)". Treat quoted
    // non-audio device names as video candidates; audio devices usually include
    // Microphone/Audio/Realtek in their friendly name.
    if (
      lower.includes('microphone') ||
      lower.includes('audio') ||
      lower.includes('realtek') ||
      lower.includes('speaker') ||
      lower.includes('stereo mix')
    ) {
      continue;
    }
    return name;
  }
  return '';
};

const parseDirectShowAudioDevicesFromText = (text?: string): string[] => {
  const value = String(text || '');
  const lines = value.split(/\r?\n/g);
  const audioDevices: string[] = [];
  let inAudioSection = false;

  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('directshow audio devices')) {
      inAudioSection = true;
      continue;
    }
    if (lowerLine.includes('directshow video devices')) {
      inAudioSection = false;
      continue;
    }

    const match = line.match(/"([^"]+)"/);
    if (!match?.[1]) {
      continue;
    }
    const name = match[1].trim();
    const lower = name.toLowerCase();
    if (!name || lower.startsWith('@device')) {
      continue;
    }

    const looksLikeAudio =
      inAudioSection ||
      lower.includes('microphone') ||
      lower.includes('mic') ||
      lower.includes('audio') ||
      lower.includes('realtek') ||
      lower.includes('stereo mix') ||
      lowerLine.includes('(audio)');
    const looksLikeSpeakerOnly =
      lower.includes('speaker') ||
      lower.includes('headphone') ||
      lower.includes('headset earphone') ||
      lower.includes('output');

    if (looksLikeAudio && !looksLikeSpeakerOnly && !audioDevices.includes(name)) {
      audioDevices.push(name);
    }
  }

  return audioDevices;
};

const pickDefaultMicrophoneDevice = (audioDevices?: string[]): string => {
  const devices = uniqueValues(audioDevices || []).filter(device => {
    const lower = String(device || '').toLowerCase();
    return !!device && !lower.startsWith('@device') && !lower.includes('speaker') && !lower.includes('headphone');
  });
  if (!devices.length) {
    return '';
  }
  return (
    devices.find(device => /microphone|mic/i.test(device)) ||
    devices.find(device => /realtek|usb|webcam|camera/i.test(device)) ||
    devices[0]
  );
};

export const listWindowsFfmpegVideoDevices = async (ffmpegPath?: string) => {
  const nativeModule = getNativeModule();

  if (!nativeModule?.listDevices) {
    const result = {
      videoDevices: [] as string[],
      audioDevices: [] as string[],
      ffmpegPath: normalizeNativeFfmpegPath(ffmpegPath),
      error: 'WindowsFfmpegLiveModule.listDevices missing',
    };
    console.log('[LiveDeviceList]', {
      ...result,
      selectedVideoDevice: '',
      selectedAudioDevice: '',
    });
    return result;
  }

  try {
    const resolvedFfmpegPath = await resolveUsableFfmpegPath(nativeModule, ffmpegPath);
    const result = await nativeModule.listDevices(resolvedFfmpegPath || '');
    const nativeVideoDevices = Array.isArray(result?.videoDevices) ? result.videoDevices : [];
    const friendlyVideoDevice = parseFirstDirectShowVideoDeviceFromText(result?.outputPreview || result?.rawOutput || '');
    // v34: Prefer the DirectShow friendly camera name for the actual FFmpeg input.
    // FFmpeg can enumerate the alternative @device_pnp moniker from inside the app,
    // but the same moniker then fails at Start with `Unable to BindToObject`.
    // The user's PowerShell test proved `video="2K Web Camera"` opens correctly,
    // so put the friendly name first and keep monikers only as diagnostics/fallback.
    const videoDevices = uniqueValues([
      friendlyVideoDevice,
      ...nativeVideoDevices,
    ]);
    const fallbackVideoDevice = friendlyVideoDevice && nativeVideoDevices.length === 0
      ? friendlyVideoDevice
      : '';
    const parsedAudioDevices = parseDirectShowAudioDevicesFromText(result?.rawOutput || result?.outputPreview || '');
    const audioDevices = uniqueValues([
      ...(Array.isArray(result?.audioDevices) ? result.audioDevices : []),
      ...parsedAudioDevices,
    ]);
    const normalizedResult = {
      ...result,
      videoDevices,
      audioDevices,
    };
    console.log('[LiveDeviceList]', {
      videoDevices: normalizedResult.videoDevices,
      audioDevices: normalizedResult.audioDevices,
      selectedVideoDevice: fallbackVideoDevice || '',
      selectedAudioDevice: '',
      ffmpegPath: result?.ffmpegPath || resolvedFfmpegPath || '',
      outputPreview: result?.outputPreview || '',
      parserFallback: Boolean(fallbackVideoDevice),
      error: result?.error,
    });
    return normalizedResult;
  } catch (error: any) {
    const result = {
      videoDevices: [] as string[],
      audioDevices: [] as string[],
      ffmpegPath: normalizeNativeFfmpegPath(ffmpegPath),
      error: error?.message || String(error),
    };
    console.log('[LiveDeviceList]', {
      ...result,
      selectedVideoDevice: '',
      selectedAudioDevice: '',
    });
    return result;
  }
};

const buildPoolOverlayFilter = (
  snapshot: WindowsFfmpegOverlaySnapshot | null | undefined,
  width: number,
  height: number,
) => {
  const left = normalizePlayer(snapshot, 0);
  const right = normalizePlayer(snapshot, 1);
  const goalText = escapeDrawText(`Mục tiêu ${Number(snapshot?.goal || 0) || '-'}`);
  const turnText = escapeDrawText(`Lượt ${Number(snapshot?.totalTurns || 0)}`);
  const timerValue = snapshot?.countdownTime == null
    ? '--'
    : `${Math.max(0, Math.ceil(Number(snapshot.countdownTime || 0)))}s`;
  const timerText = escapeDrawText(timerValue);
  const leftLabel = escapeDrawText(`${left.flag ? `${left.flag} ` : ''}${left.name}`);
  const rightLabel = escapeDrawText(`${right.name}${right.flag ? ` ${right.flag}` : ''}`);
  const scoreText = escapeDrawText(`${left.score}      ${right.score}`);
  const barHeight = Math.round(height * 0.104);
  const barY = height - Math.round(height * 0.052) - barHeight;
  const red = '0xC91D24';

  return [
    `drawbox=x=0:y=0:w=iw:h=110:color=black@0.48:t=fill`,
    `drawtext=text='A+Plus':x=48:y=35:fontsize=36:fontcolor=white`,
    `drawtext=text='BILLIARDS':x=56:y=73:fontsize=14:fontcolor=white@0.9`,
    `drawbox=x=${Math.round(width * 0.07)}:y=${barY}:w=${Math.round(width * 0.86)}:h=${barHeight}:color=${red}@0.88:t=fill`,
    `drawbox=x=${Math.round(width * 0.07)}:y=${barY + barHeight - 8}:w=${Math.round(width * 0.86)}:h=8:color=white@0.18:t=fill`,
    `drawtext=text='${leftLabel}':x=${Math.round(width * 0.09)}:y=${barY + 18}:fontsize=28:fontcolor=white`,
    `drawtext=text='${rightLabel}':x=w-text_w-${Math.round(width * 0.09)}:y=${barY + 18}:fontsize=28:fontcolor=white`,
    `drawtext=text='${scoreText}':x=(w-text_w)/2:y=${barY + 2}:fontsize=58:fontcolor=white`,
    `drawtext=text='${goalText}':x=(w-text_w)/2-${Math.round(width * 0.035)}:y=${barY + 68}:fontsize=18:fontcolor=white`,
    `drawtext=text='${turnText}':x=(w-text_w)/2+${Math.round(width * 0.045)}:y=${barY + 68}:fontsize=18:fontcolor=white`,
    `drawtext=text='${timerText}':x=(w-text_w)/2:y=${barY + barHeight + 8}:fontsize=20:fontcolor=white`,
  ].join(',');
};

const buildCaromOverlayFilter = (
  snapshot: WindowsFfmpegOverlaySnapshot | null | undefined,
  width: number,
  height: number,
) => {
  const left = normalizePlayer(snapshot, 0);
  const right = normalizePlayer(snapshot, 1);
  const panelW = Math.round(width * 0.18);
  const panelH = Math.round(height * 0.16);
  const panelX = Math.round(width * 0.024);
  const panelY = height - Math.round(height * 0.04) - panelH;
  const targetText = escapeDrawText(`Target ${Number(snapshot?.goal || 0) || '-'}`);
  const turnText = escapeDrawText(`Turn ${Number(snapshot?.totalTurns || 0)}`);
  const timerText = escapeDrawText(
    snapshot?.countdownTime == null
      ? '--'
      : `${Math.max(0, Math.ceil(Number(snapshot.countdownTime || 0)))}s`,
  );
  const leftLine = escapeDrawText(`${left.flag ? `${left.flag} ` : ''}${left.name}  ${left.score}`);
  const rightLine = escapeDrawText(`${right.flag ? `${right.flag} ` : ''}${right.name}  ${right.score}`);
  const leftStats = escapeDrawText(
    `HR1 ${left.highestRate || left.currentPoint || 0}  HR2 ${left.secondHighestRate || 0}  AVG ${left.average || 0}`,
  );
  const rightStats = escapeDrawText(
    `HR1 ${right.highestRate || right.currentPoint || 0}  HR2 ${right.secondHighestRate || 0}  AVG ${right.average || 0}`,
  );

  return [
    `drawbox=x=0:y=0:w=iw:h=110:color=black@0.48:t=fill`,
    `drawtext=text='A+Plus':x=48:y=35:fontsize=36:fontcolor=white`,
    `drawtext=text='BILLIARDS':x=56:y=73:fontsize=14:fontcolor=white@0.9`,
    `drawbox=x=${panelX}:y=${panelY}:w=${panelW}:h=${panelH}:color=black@0.68:t=fill`,
    `drawbox=x=${panelX}:y=${panelY}:w=8:h=${panelH}:color=0xC91D24@0.95:t=fill`,
    `drawtext=text='${leftLine}':x=${panelX + 22}:y=${panelY + 16}:fontsize=24:fontcolor=white`,
    `drawtext=text='${leftStats}':x=${panelX + 22}:y=${panelY + 46}:fontsize=16:fontcolor=white@0.88`,
    `drawtext=text='${rightLine}':x=${panelX + 22}:y=${panelY + 78}:fontsize=24:fontcolor=white`,
    `drawtext=text='${rightStats}':x=${panelX + 22}:y=${panelY + 108}:fontsize=16:fontcolor=white@0.88`,
    `drawtext=text='${targetText}':x=${panelX + 22}:y=${panelY + panelH - 30}:fontsize=16:fontcolor=white@0.9`,
    `drawtext=text='${turnText}':x=${panelX + Math.round(panelW * 0.48)}:y=${panelY + panelH - 30}:fontsize=16:fontcolor=white@0.9`,
    `drawtext=text='${timerText}':x=${panelX + panelW - 70}:y=${panelY + panelH - 30}:fontsize=16:fontcolor=white@0.9`,
  ].join(',');
};

const buildOverlayFilter = (
  snapshot: WindowsFfmpegOverlaySnapshot | null | undefined,
  width: number,
  height: number,
) => {
  const overlay = isCaromSnapshot(snapshot)
    ? buildCaromOverlayFilter(snapshot, width, height)
    : buildPoolOverlayFilter(snapshot, width, height);
  return `${overlay},format=yuv420p`;
};

export const buildFfmpegCommand = (
  config: WindowsFfmpegLiveConfig,
  snapshot?: WindowsFfmpegOverlaySnapshot | null,
) => {
  const {width, height} = resolveDimensions(config);
  const fps = resolveFps(config);
  const bitrate = resolveBitrate(config);
  const bitrateKbps = Number(String(bitrate).replace(/k$/i, '')) || 5200;
  // v73 stable no-mic: keep the proven anullsrc ingest and avoid the overly
  // tight v2 encoder settings that can make YouTube/player startup unstable.
  // 700k VBV + ~0.33s GOP is still low-delay, but gives YouTube enough buffer
  // to stay active while overlay snapshots are throttled separately.
  const lowLatencyBufferSize = bitrateKbps <= 3200 ? '520k' : bitrateKbps <= 5600 ? '700k' : '900k';
  const videoEncoder = resolveVideoEncoder(config);
  const directShowInputMode = resolveDirectShowInputMode(config);
  const outputUrl = normalizeRtmpOutput(config.rtmpUrl, config.streamKey);
  const gop = Math.max(10, Math.round(fps / 3));
  const keyintMin = Math.max(6, Math.min(gop, Math.round(gop * 0.6)));
  const cameraDeviceName = String(config.cameraDeviceName || '').trim();
  const audioDeviceName = String(config.audioDeviceName || '').trim();
  const ffmpegPath = String(config.ffmpegPath || 'ffmpeg').trim() || 'ffmpeg';
  const useScreenCapture = isScreenCaptureSentinel(cameraDeviceName);

  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'info',
    '-fflags',
    'nobuffer',
    '-flags',
    'low_delay',
    '-probesize',
    '32',
    '-analyzeduration',
    '0',
  ];

  if (useScreenCapture) {
    // Debug-only fallback path. Production v38 does not add the screen sentinel to
    // camera candidates, so normal YouTube live sends only the physical camera.
    args.push(
      '-thread_queue_size',
      '512',
      '-f',
      'gdigrab',
      '-framerate',
      String(fps),
      '-draw_mouse',
      '0',
      '-i',
      'desktop',
    );
  } else {
    // v22 CAMERA INGEST FIX:
    // Do not force the DirectShow input to 1920x1080/30 at capture time.
    // Some USB webcams advertise formats differently to DirectShow; forcing
    // an unsupported input mode can keep YouTube in "upcoming" because FFmpeg
    // never produces a stable ingest even though the process exists. Let the
    // camera open with its native/default mode, then normalize the outgoing
    // stream with encoder/output settings below.
    // v36 CAMERA INGEST FIX:
    // Do not force DirectShow input format/size either. The live log shows the
    // process dies before YouTube ingest starts, so open the camera with its
    // default DirectShow mode and normalize the outgoing stream below.
    // This remains webcam-only: no desktop capture, no fake/test source fallback.
    // v43: keep the camera input identical to the manual PowerShell command
    // that successfully opened the user's webcam:
    //   ffmpeg -hide_banner -f dshow -i 'video=2K Web Camera' -t 5 -f null -
    // Earlier app builds added rtbufsize/thread_queue/input format options before
    // -i. They are not required to open DirectShow and make diagnosis harder, so
    // the live path now opens the camera with the minimal known-good input first,
    // then normalizes the outgoing stream after capture.
    args.push('-f', 'dshow');

    // Keep optional modes disabled by default. They are retained only for future
    // debugging and should not run unless explicitly set.
    if (directShowInputMode === 'mjpeg720') {
      args.push('-framerate', String(fps), '-video_size', '1280x720', '-vcodec', 'mjpeg');
    } else if (directShowInputMode === 'mjpeg1080') {
      args.push('-framerate', String(fps), '-video_size', '1920x1080', '-vcodec', 'mjpeg');
    } else if (directShowInputMode === 'yuyv720') {
      args.push('-framerate', String(fps), '-video_size', '1280x720', '-pixel_format', 'yuyv422');
    }

    args.push('-i', `video=${cameraDeviceName}`);
  }

  const audioInputMode = config.audioInputMode || (config.useAudio && audioDeviceName ? 'dshow' : 'anullsrc');
  const webcamAudioDeviceName = String(config.cameraDeviceName || cameraDeviceName || '').trim();
  const hasDirectShowAudio =
    !!config.useAudio &&
    (audioInputMode === 'dshow-default' || audioInputMode === 'dshow-video' || !!audioDeviceName);
  const hasOutputAudio = audioInputMode === 'anullsrc' || !hasDirectShowAudio;

  if (hasDirectShowAudio && audioInputMode === 'dshow-default') {
    // FFmpeg build bundled with the app does not include WASAPI. Use DirectShow
    // default capture instead, then fall back to webcam-audio / silent if
    // Windows/FFmpeg cannot expose a separate microphone.
    args.push('-thread_queue_size', '512', '-f', 'dshow', '-i', 'audio=default');
  } else if (hasDirectShowAudio && audioInputMode === 'dshow-video' && webcamAudioDeviceName) {
    // Some USB webcams expose the microphone as an audio pin on the video capture
    // device and do not show a separate "DirectShow audio devices" entry. In that
    // case `audio=default` fails, but `audio=<camera name>` can still open the
    // camera's built-in microphone.
    args.push('-thread_queue_size', '512', '-f', 'dshow', '-i', `audio=${webcamAudioDeviceName}`);
  } else if (hasDirectShowAudio && audioDeviceName) {
    args.push('-thread_queue_size', '512', '-f', 'dshow', '-i', `audio=${audioDeviceName}`);
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }

  const encoderArgs = buildVideoEncoderArgs(videoEncoder);

  // STABILITY v15:
  // The Windows Event Viewer shows ffmpeg.exe itself crashing with 0xC0000005
  // at the same offset while running the drawtext/drawbox filter graph from the
  // packaged AppX path. For this build, do not use FFmpeg drawtext/filter_complex
  // at all. Stream the camera/test source directly and keep scoreboard state in
  // overlay.json/html for the web/next overlay pipeline. This is the first
  // stable in-app live baseline: YouTube must get a stream and the app must not
  // be killed by FFmpeg filter crashes.
  args.push(
    '-map',
    '0:v',
    '-map',
    hasDirectShowAudio ? '1:a?' : '1:a',
    '-vf',
    `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    ...encoderArgs,
    '-b:v',
    bitrate,
    '-maxrate',
    bitrate,
    '-bufsize',
    lowLatencyBufferSize,
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-g',
    String(Math.min(gop, 30)),
    '-keyint_min',
    String(keyintMin),
    '-sc_threshold',
    '0',
    '-x264-params',
    `bframes=0:rc-lookahead=0:sync-lookahead=0:scenecut=0:keyint=${Math.min(gop, 30)}:min-keyint=${keyintMin}:sliced-threads=1`,
    '-bf',
    '0',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-flush_packets',
    '1',
    '-max_delay',
    '0',
    '-muxdelay',
    '0',
    '-muxpreload',
    '0',
    '-avioflags',
    'direct',
    '-rtmp_live',
    'live',
    '-tcp_nodelay',
    '1',
    '-flvflags',
    'no_duration_filesize',
    '-f',
    'flv',
    outputUrl,
  );

  const maskedArgs = args.map(arg =>
    arg === outputUrl
      ? normalizeRtmpOutput(config.rtmpUrl, maskStreamKey(config.streamKey))
      : arg.includes(config.streamKey)
        ? arg.replace(config.streamKey, maskStreamKey(config.streamKey))
        : arg,
  );

  const commandMasked = [quoteArg(ffmpegPath), ...maskedArgs.map(quoteArg)].join(' ');

  console.log('[LiveFfmpegCommand]', {
    rtmpUrl: String(config.rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL).replace(/\/+$/g, ''),
    streamKeyMasked: maskStreamKey(config.streamKey),
    resolution: `${width}x${height}`,
    fps,
    bitrate,
    videoEncoder,
    captureSource: useScreenCapture ? 'desktop-gdigrab' : 'directshow',
    cameraInputMode: useScreenCapture ? DESKTOP_CAPTURE_LABEL : `directshow-camera-${directShowInputMode}`,
    audioEnabled: hasOutputAudio,
    audioInputMode: audioInputMode === 'anullsrc' ? 'anullsrc' : audioInputMode,
    audioDeviceName: audioDeviceName || (audioInputMode === 'dshow-default' ? 'default' : ''),
  });

  return {
    ffmpegPath,
    args,
    commandMasked,
    rtmpUrl: String(config.rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL).replace(/\/+$/g, ''),
    streamKeyMasked: maskStreamKey(config.streamKey),
    resolution: `${width}x${height}`,
    fps,
    bitrate,
    videoEncoder,
    captureSource: useScreenCapture ? 'desktop-gdigrab' : 'directshow',
    cameraInputMode: useScreenCapture ? DESKTOP_CAPTURE_LABEL : `directshow-camera-${directShowInputMode}`,
    audioEnabled: hasOutputAudio,
    audioInputMode: audioInputMode === 'anullsrc' ? 'anullsrc' : audioInputMode,
    audioDeviceName: audioDeviceName || (audioInputMode === 'dshow-default' ? 'default' : ''),
  };
};

export const updateWindowsFfmpegOverlay = async (
  snapshot: WindowsFfmpegOverlaySnapshot,
) => {
  const paths = getWindowsLiveOverlayPaths();

  try {
    await RNFS.mkdir(paths.root);
  } catch (_error) {}

  const now = Date.now();
  const payload = {
    ...snapshot,
    updatedAt: now,
    source: 'gameplay-shared-overlay-snapshot-data',
    parity: buildOverlayParity(snapshot),
  };

  const overlaySignature = JSON.stringify({
    category: snapshot.category,
    mode: snapshot.mode,
    currentPlayerIndex: snapshot.currentPlayerIndex,
    countdownTime: Math.ceil(Number(snapshot.countdownTime || 0)),
    warmUpCountdownTime:
      snapshot.warmUpCountdownTime == null
        ? null
        : Math.ceil(Number(snapshot.warmUpCountdownTime || 0)),
    gameBreakEnabled: !!snapshot.gameBreakEnabled,
    totalTurns: snapshot.totalTurns,
    goal: snapshot.goal,
    players: (snapshot.players || []).slice(0, 2).map(player => ({
      name: player?.name,
      flag: player?.flag,
      score: player?.score,
      currentPoint: player?.currentPoint,
      highestRate: player?.highestRate,
      secondHighestRate: player?.secondHighestRate,
      average: player?.average,
    })),
  });

  if (overlaySignature === lastOverlayWriteSignature && now - lastOverlayWriteAt < 900) {
    return true;
  }

  lastOverlayWriteSignature = overlaySignature;
  lastOverlayWriteAt = now;
  const shouldLogOverlay = now - lastOverlayLogAt > 5000;
  if (shouldLogOverlay) {
    lastOverlayLogAt = now;
  }

  const players = snapshot.players || [];
  const left = normalizePlayer(snapshot, 0);
  const right = normalizePlayer(snapshot, 1);
  const timerText = snapshot.countdownTime == null
    ? '--'
    : `${Math.max(0, Math.ceil(Number(snapshot.countdownTime || 0)))}s`;

  try {
    const payloadJson = JSON.stringify(payload, null, 2);
    await RNFS.writeFile(paths.jsonPath, payloadJson, 'utf8');
    try {
      await RNFS.mkdir(paths.nativeRoot);
      await RNFS.writeFile(paths.nativeJsonPath, payloadJson, 'utf8');
    } catch (nativeOverlayError) {
      if (shouldLogOverlay) {
        console.log('[LiveOverlayNativeCopy] failed', {
          nativeJsonPath: paths.nativeJsonPath,
          error: nativeOverlayError,
        });
      }
    }
    await RNFS.writeFile(
      paths.htmlPath,
      '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:transparent"></body></html>',
      'utf8',
    );
    lastOverlayPath = paths.jsonPath;
  } catch (error) {
    console.log('[LiveOverlay]', {
      overlayMode: 'json/html',
      overlayPath: paths.jsonPath,
      overlayExists: false,
      overlayUpdatedAt: Date.now(),
      snapshotScore: players.map(player => player.score),
      snapshotMode: snapshot.category,
      error,
    });
    return false;
  }

  let overlayExists = false;
  let fileSize = 0;
  try {
    overlayExists = await RNFS.exists(paths.jsonPath);
    if (overlayExists) {
      const stat = await RNFS.stat(paths.jsonPath);
      fileSize = Number(stat.size || 0);
    }
  } catch (_error) {}

  const parity = buildOverlayParity(snapshot);

  if (shouldLogOverlay) {
    console.log('[WindowsLiveOverlayParity]', parity);
    console.log('[WindowsLiveOverlayUpdate]', {
      overlayPath: paths.jsonPath,
      nativeOverlayPath: paths.nativeJsonPath,
      updatedAt: payload.updatedAt,
      scoreSnapshot: players.map(player => player.score),
      timerSnapshot: snapshot.countdownTime,
      fileExists: overlayExists,
      fileSize,
    });
    console.log('[LiveOverlay]', {
      overlayMode: 'json/html-only-ffmpeg-drawtext-disabled',
      overlayPath: paths.jsonPath,
      nativeOverlayPath: paths.nativeJsonPath,
      overlayExists,
      overlayUpdatedAt: payload.updatedAt,
      snapshotScore: players.map(player => player.score),
      snapshotMode: snapshot.category,
    });
  }

  return true;
};

export const startWindowsFfmpegYouTubeLive = async (
  config: WindowsFfmpegLiveConfig,
  snapshot?: WindowsFfmpegOverlaySnapshot | null,
) => {
  if (Platform.OS !== 'windows') {
    return {ok: false, error: i18n.t('ffmpegWindowsOnly') as string};
  }

  logLiveAuditOnce();

  const alreadyRunningStatus = await getWindowsFfmpegLiveStatus().catch(() => null);
  const alreadyRunningStatusText = String(alreadyRunningStatus?.status || '');
  if (alreadyRunningStatusText === 'live' || alreadyRunningStatusText === 'starting') {
    liveState = alreadyRunningStatusText as WindowsFfmpegLiveState;
    console.log('[LiveFfmpegProcess]', {
      start: false,
      pid: alreadyRunningStatus?.pid,
      stderrSummary: 'duplicate start skipped: FFmpeg live process is already running',
      status: alreadyRunningStatusText,
      stopped: false,
      exitCode: undefined,
      error: undefined,
      duplicateStartSkipped: true,
    });
    console.log('[LiveState]', {status: alreadyRunningStatusText, duplicateStartSkipped: true});
    return {ok: true, pid: alreadyRunningStatus?.pid, alreadyRunning: true};
  }

  const normalizedConfig: WindowsFfmpegLiveConfig = {
    platform: 'youtube',
    rtmpUrl: config.rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL,
    streamKey: config.streamKey,
    // v41: sanitize saved/debug FFmpeg paths from AppX/Packages. Native will
    // auto-resolve to a normal desktop LocalAppData copy before DirectShow opens.
    ffmpegPath: normalizeNativeFfmpegPath(config.ffmpegPath),
    cameraDeviceName: config.cameraDeviceName,
    audioDeviceName: config.audioDeviceName,
    useAudio: config.useAudio ?? true,
    audioInputMode: config.audioInputMode || 'anullsrc',
    // Stable detached live process with balanced 1080p30 output.
    // 5200k is high enough to avoid the soft 720p look, while the small VBV
    // buffer keeps YouTube ultra-low latency from growing again.
    resolution: config.resolution || Resolution.FullHD,
    fps: config.fps || Fps.F30,
    bitrate: config.bitrate || '5200k',
    overlayMode: 'none',
    videoEncoder: 'libx264',
  };

  console.log('[LiveWindowsMode]', {
    selectedMode: 'ffmpeg-local',
    usesNgrok: false,
    usesMetro: false,
    usesRender: false,
  });

  if (!normalizedConfig.streamKey?.trim()) {
    liveState = 'error';
    console.log('[LiveState]', {status: 'error', reason: 'missing-stream-key'});
    return {ok: false, error: i18n.t('ffmpegStreamKeyMissing') as string};
  }

  await resetWindowsFfmpegOverlaySession('before-ffmpeg-start');
  await updateWindowsFfmpegOverlay(snapshot || {players: []});

  const ffmpegCheck = await checkFfmpegAvailable(normalizedConfig.ffmpegPath);
  if (ffmpegCheck?.available && ffmpegCheck?.ffmpegPath) {
    normalizedConfig.ffmpegPath = ffmpegCheck.ffmpegPath;
  }

  if (!ffmpegCheck?.available) {
    liveState = 'error';
    console.log('[LiveFfmpegProcess]', {
      start: false,
      pid: undefined,
      stderrSummary: ffmpegCheck?.error,
      status: 'error',
      stopped: false,
      exitCode: undefined,
      error: ffmpegCheck?.error,
    });
    return {
      ok: false,
      error:
        ffmpegCheck?.error ||
        i18n.t('ffmpegNotFound') as string,
    };
  }

  const deviceList = await listWindowsFfmpegVideoDevices(normalizedConfig.ffmpegPath);
  if (deviceList.ffmpegPath) {
    normalizedConfig.ffmpegPath = deviceList.ffmpegPath;
  }

  const detectedAudioDevice = pickDefaultMicrophoneDevice(deviceList.audioDevices || []);
  if (!String(normalizedConfig.audioDeviceName || '').trim() && detectedAudioDevice) {
    normalizedConfig.audioDeviceName = detectedAudioDevice;
    normalizedConfig.audioInputMode = 'dshow';
    normalizedConfig.useAudio = true;
  }

  const cameraCandidates = uniqueValues([
    normalizedConfig.cameraDeviceName,
    ...(deviceList.videoDevices || []),
  ]).filter(device => !device.toLowerCase().startsWith('@device'));

  // v38: camera-only YouTube live. The v37 desktop fallback proved YouTube ingest
  // works, but it streamed the operator's whole desktop. Production must send only
  // the selected DirectShow camera. GamePlayViewModel now unmounts/releases the
  // MediaCapture preview before this function runs so FFmpeg can own the webcam.
  if (!normalizedConfig.cameraDeviceName?.trim() && cameraCandidates[0]) {
    normalizedConfig.cameraDeviceName = cameraCandidates[0];
  }

  if (cameraCandidates.length === 0) {
    liveState = 'error';
    const error = 'Không tìm thấy camera Windows để phát YouTube.';
    console.log('[LiveDeviceList]', {
      videoDevices: deviceList.videoDevices || [],
      audioDevices: deviceList.audioDevices || [],
      ffmpegPath: deviceList.ffmpegPath || normalizedConfig.ffmpegPath || '',
      selectedVideoDevice: '',
      candidateCount: 0,
      selectedAudioDevice: normalizedConfig.audioDeviceName || '',
      reason: 'camera-only-no-directshow-camera-found',
    });
    console.log('[LiveState]', {status: 'error', reason: 'no-camera-device'});
    return {ok: false, error};
  }

  console.log('[LiveDeviceList]', {
    videoDevices: deviceList.videoDevices || [],
    audioDevices: deviceList.audioDevices || [],
    ffmpegPath: deviceList.ffmpegPath || normalizedConfig.ffmpegPath || '',
    selectedVideoDevice: normalizedConfig.cameraDeviceName || cameraCandidates[0] || '',
    candidateCount: cameraCandidates.length,
    selectedAudioDevice: normalizedConfig.audioDeviceName || '',
    reason: 'camera-only-directshow-no-desktop-capture',
  });


  // v71 stable live first: do not try to capture microphones during YouTube startup.
  // In the packaged Windows app, FFmpeg DirectShow cannot enumerate audio devices
  // even though the same ffmpeg.exe can record mic from PowerShell. Those retries
  // kill the ingest process and keep YouTube stuck at ready/upcoming. Always give
  // YouTube a stable AAC track using lavfi anullsrc; real microphone can be added
  // later behind a separate experimental toggle.
  normalizedConfig.useAudio = true;
  normalizedConfig.audioDeviceName = '';
  normalizedConfig.audioInputMode = 'anullsrc';

  console.log('[LiveAudioDevice]', {
    status: 'microphone-disabled-stable-live',
    action: 'use-lavfi-anullsrc-only',
    reason: 'keep-youtube-ingest-stable-and-start-in-parallel-with-gameplay',
  });

  const nativeModule = getNativeModule();

  if (!nativeModule?.start) {
    liveState = 'error';
    const error = i18n.t('ffmpegStartModuleMissing') as string;
    console.log('[LiveFfmpegProcess]', {
      start: false,
      pid: undefined,
      stderrSummary: error,
      status: 'error',
      stopped: false,
      exitCode: undefined,
      error,
    });
    return {ok: false, error};
  }

  const directShowInputModeCandidates = buildDirectShowInputModeCandidates(normalizedConfig.directShowInputMode);
  const encoderCandidates = buildEncoderCandidates(normalizedConfig.videoEncoder);
  const audioCandidates: Array<Pick<WindowsFfmpegLiveConfig, 'useAudio' | 'audioDeviceName' | 'audioInputMode'>> = [
    {useAudio: true, audioDeviceName: '', audioInputMode: 'anullsrc'},
  ];

  let lastStartError = '';

  for (const cameraDeviceName of cameraCandidates) {
    for (const directShowInputMode of directShowInputModeCandidates) {
      for (const videoEncoder of encoderCandidates) {
        for (const audioCandidate of audioCandidates) {
        const attemptConfig: WindowsFfmpegLiveConfig = {
          ...normalizedConfig,
          ...audioCandidate,
          cameraDeviceName,
          directShowInputMode,
          videoEncoder,
        };
      const command = buildFfmpegCommand(attemptConfig, snapshot);

      console.log('[WindowsLiveStart]', {
        mode: 'ffmpeg-local-youtube-rtmp',
        rtmpUrl: command.rtmpUrl,
        streamKeyMasked: command.streamKeyMasked,
        cameraDevice: isScreenCaptureSentinel(attemptConfig.cameraDeviceName) ? 'desktop' : attemptConfig.cameraDeviceName,
        captureSource: isScreenCaptureSentinel(attemptConfig.cameraDeviceName) ? 'desktop-gdigrab-live-capture' : 'directshow-camera',
        overlayEnabled: attemptConfig.overlayMode !== 'none',
        overlayPath: getLastWindowsFfmpegOverlayPath(),
        ffmpegAvailable: !!ffmpegCheck?.available,
        videoEncoder,
        directShowInputMode,
        audioEnabled: !!attemptConfig.useAudio,
        audioInputMode: attemptConfig.audioInputMode || 'anullsrc',
        audioDeviceName:
          attemptConfig.audioDeviceName ||
          (attemptConfig.audioInputMode === 'dshow-default'
            ? 'default'
            : attemptConfig.audioInputMode === 'dshow-video'
              ? attemptConfig.cameraDeviceName || cameraDeviceName || ''
              : ''),
        cameraCandidateIndex: cameraCandidates.indexOf(cameraDeviceName) + 1,
        cameraCandidateCount: cameraCandidates.length,
        commandPreview: '[hidden to avoid Metro/log pressure]',
      });

      liveState = 'starting';
      console.log('[LiveState]', {
        status: 'starting',
        videoEncoder,
        cameraDeviceName,
        directShowInputMode,
        audioEnabled: !!attemptConfig.useAudio,
        audioInputMode: attemptConfig.audioInputMode || 'anullsrc',
        audioDeviceName:
          attemptConfig.audioDeviceName ||
          (attemptConfig.audioInputMode === 'dshow-default'
            ? 'default'
            : attemptConfig.audioInputMode === 'dshow-video'
              ? attemptConfig.cameraDeviceName || cameraDeviceName || ''
              : ''),
      });

      try {
        const nativeStartPromise = nativeModule.start({
          ffmpegPath: command.ffmpegPath || attemptConfig.ffmpegPath || '',
          args: command.args,
          commandMasked: command.commandMasked,
        });
        const result = await Promise.race([
          nativeStartPromise,
          wait(18000).then(() => {
            throw new Error('FFmpeg native start timed out before returning. This prevents the app from hanging on Đang tạo phiên live.');
          }),
        ]);

        if (result?.error) {
          const errorText = String(result.error || '');
          if (errorText.toLowerCase().includes('already running')) {
            liveState = 'live';
            console.log('[LiveFfmpegProcess]', {
              start: false,
              pid: result?.pid,
              stderrSummary: errorText,
              status: 'live',
              stopped: false,
              exitCode: undefined,
              error: undefined,
              duplicateStartSkipped: true,
              videoEncoder,
              directShowInputMode,
              cameraDeviceName,
            });
            console.log('[LiveState]', {status: 'live', duplicateStartSkipped: true});
            return {ok: true, pid: result?.pid, videoEncoder, alreadyRunning: true};
          }
          throw new Error(result.error);
        }

        if (result?.alreadyRunning) {
          liveState = 'live';
          console.log('[LiveFfmpegProcess]', {
            start: false,
            pid: result?.pid,
            stderrSummary: 'duplicate start skipped: native FFmpeg process is already live',
            status: 'live',
            stopped: false,
            exitCode: undefined,
            error: undefined,
            duplicateStartSkipped: true,
            videoEncoder,
            directShowInputMode,
            cameraDeviceName,
          });
          console.log('[LiveState]', {status: 'live', duplicateStartSkipped: true});
          return {ok: true, pid: result?.pid, videoEncoder, alreadyRunning: true};
        }

        // Do not mark the app live immediately. The old flow returned success as
        // soon as CreateProcessW succeeded, so YouTube could stay "upcoming" while
        // FFmpeg had already exited with DirectShow/RTMP errors. Keep the process
        // alive for a short sanity window before accepting the live state.
        let lastStatus: any = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await wait(350);
          lastStatus = await nativeModule.status?.();
          if (looksLikeEarlyFfmpegFailure(lastStatus)) {
            const failureSummary = getStartupFailureSummary(lastStatus);
            throw new Error(failureSummary || 'FFmpeg stopped before YouTube ingest became active');
          }
        }

        liveState = 'live';
        currentConfig = attemptConfig;

        console.log('[LiveFfmpegProcess]', {
          start: true,
          pid: result?.pid,
          stderrSummary: getStartupFailureSummary(lastStatus) || undefined,
          status: 'live',
          stopped: false,
          exitCode: undefined,
          error: undefined,
          videoEncoder,
          directShowInputMode,
          cameraDeviceName,
        });
        console.log('[LiveState]', {status: 'live', videoEncoder, cameraDeviceName, directShowInputMode});

        return {ok: true, pid: result?.pid, videoEncoder};
      } catch (error: any) {
        lastStartError = error?.message || String(error);
        console.log('[LiveFfmpegProcess]', {
          start: false,
          pid: undefined,
          stderrSummary: lastStartError,
          status: 'retrying',
          stopped: true,
          exitCode: undefined,
          error: lastStartError,
          videoEncoder,
          directShowInputMode,
          cameraDeviceName,
          nextCamera: cameraCandidates[cameraCandidates.indexOf(cameraDeviceName) + 1] || '',
          nextEncoder: encoderCandidates[encoderCandidates.indexOf(videoEncoder) + 1] || '',
        });
        try {
          await nativeModule.stop?.();
        } catch (_stopError) {}
        await wait(500);
      }
      }
    }
  }
  }

  liveState = 'error';
  console.log('[LiveState]', {status: 'error', reason: 'all-camera-or-encoder-candidates-failed'});
  return {
    ok: false,
    error: lastStartError || 'FFmpeg could not start with any camera device or video encoder',
  };
};

export const stopWindowsFfmpegYouTubeLive = async (reason = 'user-stop') => {
  if (Platform.OS !== 'windows') {
    return {ok: true, stopped: true};
  }

  const nativeModule = getNativeModule();
  liveState = 'stopping';
  console.log('[LiveState]', {status: 'stopping', reason});

  if (!nativeModule?.stop) {
    liveState = 'stopped';
    currentConfig = null;
    console.log('[LiveFfmpegProcess]', {
      start: false,
      pid: undefined,
      stderrSummary: 'WindowsFfmpegLiveModule.stop missing',
      status: 'stopped',
      stopped: true,
      exitCode: undefined,
      error: undefined,
    });
    console.log('[WindowsLiveStop]', {
      processStopped: true,
      cleanupDone: true,
      error: 'WindowsFfmpegLiveModule.stop missing',
    });
    console.log('[LiveState]', {status: 'stopped'});
    return {ok: true, stopped: true};
  }

  try {
    const result = await nativeModule.stop();
    liveState = 'stopped';
    currentConfig = null;
    console.log('[LiveFfmpegProcess]', {
      start: false,
      pid: undefined,
      stderrSummary: undefined,
      status: 'stopped',
      stopped: true,
      exitCode: result?.exitCode,
      error: result?.error,
    });
    console.log('[WindowsLiveStop]', {
      processStopped: !!result?.stopped,
      cleanupDone: true,
      error: result?.error,
    });
    console.log('[LiveState]', {status: 'stopped'});
    return {ok: true, stopped: true, exitCode: result?.exitCode};
  } catch (error: any) {
    liveState = 'error';
    console.log('[LiveFfmpegProcess]', {
      start: false,
      pid: undefined,
      stderrSummary: error?.message || String(error),
      status: 'error',
      stopped: false,
      exitCode: undefined,
      error: error?.message || String(error),
    });
    console.log('[WindowsLiveStop]', {
      processStopped: false,
      cleanupDone: false,
      error: error?.message || String(error),
    });
    console.log('[LiveState]', {status: 'error'});
    return {ok: false, error: error?.message || String(error)};
  }
};

export const toWindowsFfmpegSnapshot = (snapshot: any): WindowsFfmpegOverlaySnapshot => {
  const players = snapshot?.playerSettings?.playingPlayers || [];
  return {
    category: snapshot?.gameSettings?.category || snapshot?.category,
    mode: snapshot?.gameSettings?.mode?.mode || snapshot?.gameMode,
    currentPlayerIndex: snapshot?.currentPlayerIndex,
    countdownTime: snapshot?.countdownTime,
    warmUpCountdownTime: snapshot?.warmUpCountdownTime,
    gameBreakEnabled: !!snapshot?.gameBreakEnabled,
    totalTurns: snapshot?.totalTurns,
    goal: snapshot?.goal || snapshot?.gameSettings?.players?.goal?.goal || snapshot?.playerSettings?.goal?.goal,
    players: players.map((player: any) => ({
      name: player?.name,
      flag: typeof player?.flag === 'string'
        ? player.flag
        : player?.country?.flag || player?.countryCode || player?.country || '',
      score: Number(player?.totalPoint || 0),
      currentPoint: Number(player?.proMode?.currentPoint || 0),
      highestRate: Number(player?.proMode?.highestRate || player?.proMode?.highestRun || 0),
      secondHighestRate: Number(player?.proMode?.secondHighestRate || 0),
      average: Number(player?.proMode?.average || 0),
    })),
  };
};

export const createWindowsFfmpegSnapshotFromGameState = (params: {
  gameSettings?: any;
  playerSettings?: any;
  currentPlayerIndex?: number;
  countdownTime?: number;
  warmUpCountdownTime?: number;
  gameBreakEnabled?: boolean;
  totalTurns?: number;
}) =>
  toWindowsFfmpegSnapshot({
    gameSettings: params.gameSettings,
    category: params.gameSettings?.category,
    gameMode: params.gameSettings?.mode?.mode,
    currentPlayerIndex: params.currentPlayerIndex,
    countdownTime: params.countdownTime,
    warmUpCountdownTime: params.warmUpCountdownTime,
    gameBreakEnabled: params.gameBreakEnabled,
    totalTurns: params.totalTurns,
    goal: params.gameSettings?.players?.goal?.goal || params.playerSettings?.goal?.goal,
    playerSettings: params.playerSettings,
  });

export const isWindowsFfmpegLocalLiveRunning = () => liveState === 'live' || liveState === 'starting';
export const getCurrentWindowsFfmpegLiveConfig = () => currentConfig;
export const getLastWindowsFfmpegOverlayPath = () => lastOverlayPath;
