import {NativeModules, Platform} from 'react-native';
import RNFS from 'react-native-fs';
import {Bitrate, Fps, Resolution} from 'types/webcam';

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
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');

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

  if (config.resolution === Resolution.HD) {
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
        ? 'WindowsFfmpegLiveModule chưa được đăng ký. Cần native module để spawn ffmpeg.exe trong bản Windows release.'
        : 'FFmpeg local live chỉ dùng cho Windows.',
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
      error:
        'Thiếu WindowsFfmpegLiveModule. JS đã tách khỏi ngrok/backend, nhưng bản Windows cần native module để chạy process ffmpeg.exe.',
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

  const players = snapshot?.players || [];
  const left = players[0] || {};
  const right = players[1] || {};
  const leftName = escapeDrawText(left.name || 'Player 1');
  const rightName = escapeDrawText(right.name || 'Player 2');
  const scoreText = escapeDrawText(`${Number(left.score || 0)}  -  ${Number(right.score || 0)}`);
  const timerText = escapeDrawText(
    snapshot?.countdownTime == null ? '' : `Time ${Math.max(0, Math.ceil(Number(snapshot.countdownTime || 0)))}s`,
  );

  // Phase 1 fallback: branded drawtext/drawbox overlay generated from the same gameplay state.
  // The native module can later replace this with overlay.png while keeping this command builder.
  const overlayFilter =
    `drawbox=x=0:y=0:w=iw:h=86:color=black@0.62:t=fill,` +
    `drawbox=x=0:y=86:w=iw:h=4:color=red@0.85:t=fill,` +
    `drawtext=text='APLUS SCORE':x=40:y=24:fontsize=28:fontcolor=white,` +
    `drawtext=text='${leftName}':x=340:y=18:fontsize=24:fontcolor=white,` +
    `drawtext=text='${scoreText}':x=(w-text_w)/2:y=14:fontsize=44:fontcolor=white,` +
    `drawtext=text='${rightName}':x=w-text_w-340:y=18:fontsize=24:fontcolor=white,` +
    (timerText ? `drawtext=text='${timerText}':x=(w-text_w)/2:y=62:fontsize=18:fontcolor=white,` : '') +
    `format=yuv420p`;

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
  };

  try {
    await RNFS.writeFile(paths.jsonPath, JSON.stringify(payload, null, 2), 'utf8');
    await RNFS.writeFile(
      paths.htmlPath,
      `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:transparent;color:white;font-family:Arial,sans-serif}.bar{height:86px;background:rgba(0,0,0,.62);border-bottom:4px solid #c91d24;display:flex;align-items:center;justify-content:space-around}.score{font-size:44px;font-weight:800}.name{font-size:24px;font-weight:700}.brand{font-size:28px;font-weight:900}</style></head><body><div class="bar"><div class="brand">APLUS SCORE</div><div class="name">${snapshot.players?.[0]?.name || 'Player 1'}</div><div class="score">${snapshot.players?.[0]?.score || 0} - ${snapshot.players?.[1]?.score || 0}</div><div class="name">${snapshot.players?.[1]?.name || 'Player 2'}</div></div></body></html>`,
      'utf8',
    );
    lastOverlayPath = paths.jsonPath;
  } catch (error) {
    console.log('[LiveOverlay]', {
      overlayMode: 'json/html',
      overlayPath: paths.jsonPath,
      overlayExists: false,
      overlayUpdatedAt: Date.now(),
      snapshotScore: snapshot.players?.map(player => player.score),
      snapshotMode: snapshot.category,
      error,
    });
    return false;
  }

  let overlayExists = false;
  try {
    overlayExists = await RNFS.exists(paths.jsonPath);
  } catch (_error) {}

  console.log('[LiveOverlay]', {
    overlayMode: 'drawtext+json/html',
    overlayPath: paths.jsonPath,
    overlayExists,
    overlayUpdatedAt: payload.updatedAt,
    snapshotScore: snapshot.players?.map(player => player.score),
    snapshotMode: snapshot.category,
  });

  return true;
};

export const startWindowsFfmpegYouTubeLive = async (
  config: WindowsFfmpegLiveConfig,
  snapshot?: WindowsFfmpegOverlaySnapshot | null,
) => {
  if (Platform.OS !== 'windows') {
    return {ok: false, error: 'Windows FFmpeg local live chỉ chạy trên Windows.'};
  }

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
    return {ok: false, error: 'Bạn chưa nhập Stream Key YouTube.'};
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
        'Không tìm thấy FFmpeg. Hãy cài FFmpeg, thêm vào PATH, hoặc nhập đường dẫn ffmpeg.exe.',
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
    return {ok: false, error: 'Không tìm thấy webcam/camera từ FFmpeg. Hãy kiểm tra camera hoặc nhập tên device ở cấu hình nâng cao.'};
  }

  const command = buildFfmpegCommand(normalizedConfig, snapshot);
  const nativeModule = getNativeModule();

  if (!nativeModule?.start) {
    liveState = 'error';
    const error =
      'Thiếu WindowsFfmpegLiveModule.start nên JS không thể spawn ffmpeg.exe trong RN Windows release.';
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
    goal: snapshot?.goal || snapshot?.gameSettings?.players?.goal?.goal,
    players: players.map((player: any) => ({
      name: player?.name,
      flag: player?.flag,
      score: Number(player?.totalPoint || 0),
      currentPoint: Number(player?.proMode?.currentPoint || 0),
      highestRate: Number(player?.proMode?.highestRate || 0),
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
    category: params.gameSettings?.category,
    gameMode: params.gameSettings?.mode?.mode,
    currentPlayerIndex: params.currentPlayerIndex,
    countdownTime: params.countdownTime,
    totalTurns: params.totalTurns,
    goal: params.gameSettings?.players?.goal?.goal,
    playerSettings: params.playerSettings,
  });

export const isWindowsFfmpegLocalLiveRunning = () => liveState === 'live' || liveState === 'starting';

export const getCurrentWindowsFfmpegLiveConfig = () => currentConfig;

export const getLastWindowsFfmpegOverlayPath = () => lastOverlayPath;
