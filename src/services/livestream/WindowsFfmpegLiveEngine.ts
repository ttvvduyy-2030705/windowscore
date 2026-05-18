import {NativeModules, Platform} from 'react-native';
import RNFS from 'react-native-fs';
import {Bitrate, Fps, Resolution} from 'types/webcam';
import i18n from 'i18n';

export const WINDOWS_FFMPEG_CONFIG_STORAGE_KEY = '@APLUS_WINDOWS_FFMPEG_LIVE_CONFIG_V1';
export const DEFAULT_YOUTUBE_RTMP_URL = 'rtmp://a.rtmp.youtube.com/live2';

export type WindowsFfmpegLiveState = 'stopped' | 'starting' | 'live' | 'stopping' | 'error';

export type WindowsFfmpegLiveConfig = {
  platform?: 'youtube';
  rtmpUrl: string;
  streamKey: string;
  ffmpegPath?: string;
  cameraDeviceName?: string;
  audioDeviceName?: string;
  useAudio?: boolean;
  width?: number;
  height?: number;
  resolution?: Resolution | string;
  fps?: Fps | string | number;
  bitrate?: Bitrate | string;
  overlayMode?: 'png' | 'drawtext' | 'none';
};

export type WindowsFfmpegOverlaySnapshot = {
  category?: string;
  mode?: string;
  currentPlayerIndex?: number;
  countdownTime?: number;
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
    error?: string;
  }>;
  start?: (payload: {
    ffmpegPath?: string;
    args: string[];
    commandMasked: string;
  }) => Promise<{
    pid?: number;
    status?: string;
    error?: string;
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
};

let liveState: WindowsFfmpegLiveState = 'stopped';
let currentConfig: WindowsFfmpegLiveConfig | null = null;
let lastOverlayPath = '';
let auditLogged = false;

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

const escapeDrawText = (value: string) =>
  String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\r?\n/g, ' ');

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

  return {width: 1920, height: 1080};
};

const resolveFps = (config: WindowsFfmpegLiveConfig) => {
  const fps = Number(config.fps || Fps.F30);
  return Number.isFinite(fps) && fps > 0 ? Math.min(60, Math.max(24, fps)) : 30;
};

const resolveBitrate = (config: WindowsFfmpegLiveConfig) => {
  const raw = String(config.bitrate || Bitrate.B5000).trim();
  if (/^\d+k$/i.test(raw)) {
    return raw.toLowerCase();
  }
  const numeric = Number(raw.replace(/[^\d.]/g, ''));
  if (Number.isFinite(numeric) && numeric > 0) {
    return `${Math.round(numeric)}k`;
  }
  return '6000k';
};

const getLiveRootDir = () => normalizePath(`${RNFS.ExternalDirectoryPath || RNFS.DocumentDirectoryPath}/LiveOverlay`);

export const getWindowsLiveOverlayPaths = () => {
  const root = getLiveRootDir();
  return {
    root,
    jsonPath: `${root}/overlay.json`,
    htmlPath: `${root}/overlay.html`,
    pngPath: `${root}/overlay.png`,
  };
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
    engine: 'Windows local FFmpeg DirectShow + YouTube RTMP',
    overlaySource: 'gameplay playerSettings/gameSettings/countdown snapshot rendered by FFmpeg drawtext/drawbox plus JSON/HTML debug artifact',
    startFlow: 'OAuth/backend session -> FFmpeg local start',
    stopFlow: 'send q to FFmpeg, wait, terminate fallback, backend stop',
    usesNgrok: false,
    usesMetro: false,
    usesFfmpeg: true,
  });

  [
    ['Live entry screen', 'Windows live-platform -> live-platform-setup -> gameplay', 'kept'],
    ['Auth / stream key', 'OAuth/backend returns RTMP ingest for Windows FFmpeg', 'kept'],
    ['Camera source', 'Windows DirectShow camera device in FFmpeg', 'kept'],
    ['Overlay source of truth', 'gameplay playerSettings/gameSettings snapshot', 'kept'],
    ['Overlay rendering', 'FFmpeg drawbox/drawtext from snapshot plus JSON/HTML debug artifact', 'kept'],
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
    ffmpegPath: ffmpegPath || 'PATH:ffmpeg',
    available: Boolean(nativeModule?.checkFfmpegAvailable),
    version: undefined,
    error: nativeModule?.checkFfmpegAvailable
      ? undefined
      : 'WindowsFfmpegLiveModule missing',
  });

  if (!nativeModule?.checkFfmpegAvailable) {
    return {
      available: false,
      ffmpegPath: ffmpegPath || 'ffmpeg',
      version: '',
      error: i18n.t('ffmpegModuleMissing') as string,
    };
  }

  try {
    const result = await nativeModule.checkFfmpegAvailable(ffmpegPath);
    console.log('[LiveFfmpegCheck]', {
      ffmpegPath: result?.ffmpegPath || ffmpegPath || 'PATH:ffmpeg',
      available: !!result?.available,
      version: result?.version,
      error: result?.error,
    });
    return result;
  } catch (error: any) {
    console.log('[LiveFfmpegCheck]', {
      ffmpegPath: ffmpegPath || 'PATH:ffmpeg',
      available: false,
      version: undefined,
      error: error?.message || String(error),
    });
    return {available: false, ffmpegPath, error: error?.message || String(error)};
  }
};

export const listWindowsFfmpegVideoDevices = async (ffmpegPath?: string) => {
  const nativeModule = getNativeModule();

  if (!nativeModule?.listDevices) {
    const result = {
      videoDevices: [] as string[],
      audioDevices: [] as string[],
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
    const result = await nativeModule.listDevices(ffmpegPath);
    console.log('[LiveDeviceList]', {
      videoDevices: result?.videoDevices || [],
      audioDevices: result?.audioDevices || [],
      selectedVideoDevice: '',
      selectedAudioDevice: '',
      error: result?.error,
    });
    return result;
  } catch (error: any) {
    const result = {
      videoDevices: [] as string[],
      audioDevices: [] as string[],
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
  const outputUrl = normalizeRtmpOutput(config.rtmpUrl, config.streamKey);
  const gop = Math.max(30, fps * 2);
  const cameraDeviceName = String(config.cameraDeviceName || '').trim();
  const audioDeviceName = String(config.audioDeviceName || '').trim();
  const ffmpegPath = String(config.ffmpegPath || 'ffmpeg').trim() || 'ffmpeg';

  const args: string[] = [
    '-hide_banner',
    '-loglevel',
    'info',
    '-f',
    'dshow',
    '-video_size',
    `${width}x${height}`,
    '-framerate',
    String(fps),
    '-i',
    `video=${cameraDeviceName}`,
  ];

  if (config.useAudio && audioDeviceName) {
    args.push('-f', 'dshow', '-i', `audio=${audioDeviceName}`);
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }

  const overlayFilter = buildOverlayFilter(snapshot, width, height);

  args.push(
    '-filter_complex',
    `[0:v]${overlayFilter}[vout]`,
    '-map',
    '[vout]',
    '-map',
    config.useAudio && audioDeviceName ? '1:a?' : '1:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-b:v',
    bitrate,
    '-maxrate',
    bitrate,
    '-bufsize',
    `${Math.max(1, parseInt(bitrate, 10) * 2)}k`,
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-g',
    String(gop),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '44100',
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
    commandMasked,
    rtmpUrl: String(config.rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL).replace(/\/+$/g, ''),
    streamKeyMasked: maskStreamKey(config.streamKey),
    resolution: `${width}x${height}`,
    fps,
    bitrate,
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
  };
};

export const updateWindowsFfmpegOverlay = async (
  snapshot: WindowsFfmpegOverlaySnapshot,
) => {
  const paths = getWindowsLiveOverlayPaths();

  try {
    await RNFS.mkdir(paths.root);
  } catch (_error) {}

  const payload = {
    ...snapshot,
    updatedAt: Date.now(),
    source: 'gameplay-shared-overlay-snapshot-data',
    parity: buildOverlayParity(snapshot),
  };

  const players = snapshot.players || [];
  const left = normalizePlayer(snapshot, 0);
  const right = normalizePlayer(snapshot, 1);
  const timerText = snapshot.countdownTime == null
    ? '--'
    : `${Math.max(0, Math.ceil(Number(snapshot.countdownTime || 0)))}s`;

  try {
    await RNFS.writeFile(paths.jsonPath, JSON.stringify(payload, null, 2), 'utf8');
    await RNFS.writeFile(
      paths.htmlPath,
      `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:transparent;color:white;font-family:Arial,sans-serif}.top{position:absolute;left:48px;top:28px;font-weight:900;font-size:36px}.score{position:absolute;left:7%;right:7%;bottom:5.2%;height:104px;background:rgba(201,29,36,.88);display:flex;align-items:center;justify-content:space-between;padding:0 42px;box-sizing:border-box}.name{font-size:28px;font-weight:800}.points{font-size:58px;font-weight:900}.meta{position:absolute;left:0;right:0;bottom:18px;text-align:center;font-size:20px}</style></head><body><div class="top">A+Plus</div><div class="score"><div class="name">${left.flag ? `${left.flag} ` : ''}${left.name}</div><div class="points">${left.score} - ${right.score}</div><div class="name">${right.name}${right.flag ? ` ${right.flag}` : ''}</div></div><div class="meta">Target ${snapshot.goal || '-'} · Turn ${snapshot.totalTurns || 0} · ${timerText}</div></body></html>`,
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

  console.log('[WindowsLiveOverlayParity]', parity);
  console.log('[WindowsLiveOverlayUpdate]', {
    overlayPath: paths.jsonPath,
    updatedAt: payload.updatedAt,
    scoreSnapshot: players.map(player => player.score),
    timerSnapshot: snapshot.countdownTime,
    fileExists: overlayExists,
    fileSize,
  });
  console.log('[LiveOverlay]', {
    overlayMode: 'drawtext+json/html',
    overlayPath: paths.jsonPath,
    overlayExists,
    overlayUpdatedAt: payload.updatedAt,
    snapshotScore: players.map(player => player.score),
    snapshotMode: snapshot.category,
  });

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

  const normalizedConfig: WindowsFfmpegLiveConfig = {
    platform: 'youtube',
    rtmpUrl: config.rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL,
    streamKey: config.streamKey,
    ffmpegPath: config.ffmpegPath,
    cameraDeviceName: config.cameraDeviceName,
    audioDeviceName: config.audioDeviceName,
    useAudio: config.useAudio ?? false,
    resolution: config.resolution || Resolution.FullHD,
    fps: config.fps || Fps.F30,
    bitrate: config.bitrate || Bitrate.B5000,
    overlayMode: config.overlayMode || 'drawtext',
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

  await updateWindowsFfmpegOverlay(snapshot || {players: []});

  const ffmpegCheck = await checkFfmpegAvailable(normalizedConfig.ffmpegPath);
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

  if (!normalizedConfig.cameraDeviceName?.trim()) {
    const deviceList = await listWindowsFfmpegVideoDevices(normalizedConfig.ffmpegPath);
    const firstVideoDevice = (deviceList.videoDevices || [])[0] || '';
    if (firstVideoDevice) {
      normalizedConfig.cameraDeviceName = firstVideoDevice;
      console.log('[LiveDeviceList]', {
        videoDevices: deviceList.videoDevices || [],
        audioDevices: deviceList.audioDevices || [],
        selectedVideoDevice: firstVideoDevice,
        selectedAudioDevice: normalizedConfig.audioDeviceName || '',
        reason: 'auto-selected-first-video-device',
      });
    }
  }

  if (!normalizedConfig.cameraDeviceName?.trim()) {
    liveState = 'error';
    console.log('[LiveState]', {status: 'error', reason: 'missing-camera-device'});
    return {ok: false, error: i18n.t('ffmpegCameraNotFound') as string};
  }

  const command = buildFfmpegCommand(normalizedConfig, snapshot);
  const nativeModule = getNativeModule();

  console.log('[WindowsLiveStart]', {
    mode: 'ffmpeg-local-youtube-rtmp',
    rtmpUrl: command.rtmpUrl,
    streamKeyMasked: command.streamKeyMasked,
    cameraDevice: normalizedConfig.cameraDeviceName,
    overlayEnabled: normalizedConfig.overlayMode !== 'none',
    overlayPath: getLastWindowsFfmpegOverlayPath(),
    ffmpegAvailable: !!ffmpegCheck?.available,
    commandMasked: command.commandMasked,
  });

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

  liveState = 'starting';
  console.log('[LiveState]', {status: 'starting'});

  try {
    const result = await nativeModule.start({
      ffmpegPath: normalizedConfig.ffmpegPath,
      args: command.args,
      commandMasked: command.commandMasked,
    });

    if (result?.error) {
      throw new Error(result.error);
    }

    liveState = 'live';
    currentConfig = normalizedConfig;

    console.log('[LiveFfmpegProcess]', {
      start: true,
      pid: result?.pid,
      stderrSummary: undefined,
      status: 'live',
      stopped: false,
      exitCode: undefined,
      error: undefined,
    });
    console.log('[LiveState]', {status: 'live'});

    return {ok: true, pid: result?.pid};
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
    console.log('[LiveState]', {status: 'error'});
    return {ok: false, error: error?.message || String(error)};
  }
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
  totalTurns?: number;
}) =>
  toWindowsFfmpegSnapshot({
    gameSettings: params.gameSettings,
    category: params.gameSettings?.category,
    gameMode: params.gameSettings?.mode?.mode,
    currentPlayerIndex: params.currentPlayerIndex,
    countdownTime: params.countdownTime,
    totalTurns: params.totalTurns,
    goal: params.gameSettings?.players?.goal?.goal || params.playerSettings?.goal?.goal,
    playerSettings: params.playerSettings,
  });

export const isWindowsFfmpegLocalLiveRunning = () => liveState === 'live' || liveState === 'starting';
export const getCurrentWindowsFfmpegLiveConfig = () => currentConfig;
export const getLastWindowsFfmpegOverlayPath = () => lastOverlayPath;
