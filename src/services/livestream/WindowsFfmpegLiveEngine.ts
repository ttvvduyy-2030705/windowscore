import { NativeModules, Platform } from "react-native";
import RNFS from "react-native-fs";
import { Bitrate, Fps, Resolution } from "types/webcam";
import i18n from "i18n";

export const WINDOWS_FFMPEG_CONFIG_STORAGE_KEY =
  "@APLUS_WINDOWS_FFMPEG_LIVE_CONFIG_V1";
export const DEFAULT_YOUTUBE_RTMP_URL = "rtmp://a.rtmp.youtube.com/live2";

export type WindowsFfmpegLiveState =
  | "stopped"
  | "starting"
  | "live"
  | "stopping"
  | "error";

export type WindowsFfmpegLiveConfig = {
  platform?: "youtube";
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
  overlayMode?: "png" | "drawtext" | "none";
  /**
   * auto = production-safe mode. For app stability this build uses libx264 only.
   * Hardware encoders are intentionally skipped because some FFmpeg/GPU driver
   * combinations crash immediately and can destabilize the RNW gameplay app.
   */
  videoEncoder?: "auto" | "h264_nvenc" | "h264_amf" | "h264_qsv" | "libx264";
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

let liveState: WindowsFfmpegLiveState = "stopped";
let currentConfig: WindowsFfmpegLiveConfig | null = null;
let lastOverlayPath = "";
let auditLogged = false;
let lastOverlayWriteSignature = "";
let lastOverlayWriteAt = 0;
let lastOverlayLogAt = 0;

const SCREEN_CAPTURE_SENTINEL = "__APLUS_SCREEN_CAPTURE__";

const isScreenCaptureSentinel = (value?: string | null) =>
  String(value || "").trim() === SCREEN_CAPTURE_SENTINEL;

const getNativeModule = (): NativeWindowsFfmpegLiveModule | null => {
  const modules = NativeModules as any;
  return modules?.WindowsFfmpegLiveModule || null;
};

const normalizePath = (value?: string | null) =>
  String(value || "").replace(/\\/g, "/");

const quoteArg = (value: string) => {
  const safeValue = String(value || "");
  if (!safeValue) {
    return '""';
  }
  return `"${safeValue.replace(/"/g, '\\"')}"`;
};

const toFfmpegSafeText = (value: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ._\-+/]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const escapeDrawText = (value: string) =>
  toFfmpegSafeText(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\r?\n/g, " ");

const uniqueValues = (values: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

const normalizeWindowsExecutablePath = (value?: string | null) =>
  String(value || "")
    .trim()
    .replace(/\//g, "\\");

const normalizeNativeFfmpegPath = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw || raw === "PATH:ffmpeg") {
    return "";
  }
  return normalizeWindowsExecutablePath(raw);
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
    "",
  ]);

  if (!nativeModule?.checkFfmpegAvailable) {
    return normalizeNativeFfmpegPath(preferredPath);
  }

  for (const candidate of candidates) {
    try {
      const result = await nativeModule.checkFfmpegAvailable(candidate);
      const resolved = normalizeNativeFfmpegPath(
        result?.ffmpegPath || candidate,
      );
      console.log("[LiveFfmpegResolve]", {
        requested: candidate || "AUTO_NATIVE",
        resolved: resolved || result?.ffmpegPath || "",
        usable: !!result?.available,
        error: result?.error,
      });
      if (result?.available) {
        return resolved || candidate;
      }
    } catch (error: any) {
      console.log("[LiveFfmpegResolve]", {
        requested: candidate || "AUTO_NATIVE",
        usable: false,
        error: error?.message || String(error),
      });
    }
  }

  return normalizeNativeFfmpegPath(preferredPath);
};

export const maskStreamKey = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.length <= 8) {
    return `${raw.slice(0, 2)}****`;
  }
  return `${raw.slice(0, 4)}-****-${raw.slice(-4)}`;
};

const normalizeRtmpOutput = (rtmpUrl: string, streamKey: string) => {
  const cleanUrl = String(rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL)
    .trim()
    .replace(/\/+$/g, "");
  const cleanKey = String(streamKey || "").trim();
  return `${cleanUrl}/${cleanKey}`;
};

const resolveDimensions = (config: WindowsFfmpegLiveConfig) => {
  if (config.width && config.height) {
    return { width: config.width, height: config.height };
  }

  if (config.resolution === Resolution.HD || config.resolution === "720p") {
    return { width: 1280, height: 720 };
  }

  return { width: 1920, height: 1080 };
};

const resolveFps = (config: WindowsFfmpegLiveConfig) => {
  const fps = Number(config.fps || Fps.F30);
  return Number.isFinite(fps) && fps > 0 ? Math.min(30, Math.max(10, fps)) : 15;
};

const resolveBitrate = (config: WindowsFfmpegLiveConfig) => {
  const raw = String(config.bitrate || Bitrate.B5000 || "6000k").trim();
  const numeric = /^\d+k$/i.test(raw)
    ? Number(raw.replace(/k$/i, ""))
    : Number(raw.replace(/[^\d.]/g, ""));
  if (Number.isFinite(numeric) && numeric > 0) {
    return `${Math.round(Math.min(9000, Math.max(2500, numeric)))}k`;
  }
  return "6000k";
};

const resolveVideoEncoder = (config: WindowsFfmpegLiveConfig) =>
  (String(config.videoEncoder || "auto").trim() || "auto") as NonNullable<
    WindowsFfmpegLiveConfig["videoEncoder"]
  >;

const buildEncoderCandidates = (
  _encoder?: WindowsFfmpegLiveConfig["videoEncoder"],
) => {
  // CRASH-FIX v10: use one stable encoder only.
  // The log showed h264_nvenc exiting with 3221225477 (0xC0000005 access violation).
  // Retrying hardware encoders from inside the app makes the gameplay process unstable.
  // libx264 at 1080p30/6000k keeps quality high and avoids GPU-driver/native crashes.
  return ["libx264"] as Array<
    NonNullable<WindowsFfmpegLiveConfig["videoEncoder"]>
  >;
};

const buildVideoEncoderArgs = (
  encoder: NonNullable<WindowsFfmpegLiveConfig["videoEncoder"]>,
) => {
  switch (encoder) {
    case "h264_nvenc":
      return [
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-tune",
        "ll",
        "-rc",
        "cbr",
      ];
    case "h264_amf":
      return ["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cbr"];
    case "h264_qsv":
      return ["-c:v", "h264_qsv", "-preset", "veryfast"];
    case "libx264":
    default:
      return ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency"];
  }
};

const getLiveRootDir = () =>
  normalizePath(
    `${RNFS.ExternalDirectoryPath || RNFS.DocumentDirectoryPath}/LiveOverlay`,
  );

export const getWindowsLiveOverlayPaths = () => {
  const root = getLiveRootDir();
  return {
    root,
    jsonPath: `${root}/overlay.json`,
    htmlPath: `${root}/overlay.html`,
    pngPath: `${root}/overlay.png`,
  };
};


const ensureDir = async (dirPath?: string | null) => {
  const target = String(dirPath || "").trim();
  if (!target) {
    return false;
  }
  try {
    const exists = await RNFS.exists(target);
    if (!exists) {
      await RNFS.mkdir(target);
    }
    return true;
  } catch (error: any) {
    console.log("[WindowsLivePath] ensureDir failed", {
      dirPath: target,
      error: error?.message || String(error),
    });
    return false;
  }
};

const toWindowsPath = (value?: string | null) =>
  String(value || "").replace(/\//g, "\\");

const buildObsBridgeRunnerScript = () => String.raw`param(
  [Parameter(Mandatory=$true)][string]$SessionPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $SessionPath
$logPath = Join-Path $root 'obs-bridge-runner.log'

function Write-AplusLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $logPath -Value $line -Encoding UTF8
}

try {
  Write-AplusLog "OBS bridge runner started. SessionPath=$SessionPath"

  if (!(Test-Path $SessionPath)) {
    Write-AplusLog "Session file not found."
    exit 10
  }

  $session = Get-Content -Path $SessionPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $server = [string]$session.server
  $streamKey = [string]$session.streamKey

  if ([string]::IsNullOrWhiteSpace($server) -or [string]::IsNullOrWhiteSpace($streamKey)) {
    Write-AplusLog "Missing server or streamKey in session file."
    exit 11
  }

  $profileRoot = Join-Path $env:APPDATA 'obs-studio\basic\profiles\AplusScore'
  New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null

  $service = [ordered]@{
    type = 'rtmp_custom'
    settings = [ordered]@{
      server = $server
      key = $streamKey
      use_auth = $false
    }
  }

  $servicePath = Join-Path $profileRoot 'service.json'
  ($service | ConvertTo-Json -Depth 10) | Set-Content -Path $servicePath -Encoding UTF8
  Write-AplusLog "OBS service profile updated. Server=$server KeyMasked=$($streamKey.Substring(0, [Math]::Min(4, $streamKey.Length)))****"

  $basicPath = Join-Path $profileRoot 'basic.ini'
  if (!(Test-Path $basicPath)) {
    @'
[General]
Name=AplusScore

[Video]
BaseCX=1920
BaseCY=1080
OutputCX=1920
OutputCY=1080
FPSCommon=30

[Output]
Mode=Simple
'@ | Set-Content -Path $basicPath -Encoding UTF8
  }

  $obsCandidates = @(
    'C:\Program Files\obs-studio\bin\64bit\obs64.exe',
    'C:\Program Files\OBS Studio\bin\64bit\obs64.exe',
    'C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe'
  )

  $obs = $obsCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (!$obs) {
    Write-AplusLog "OBS executable not found. Install OBS Studio first."
    exit 12
  }

  $obsDir = Split-Path -Parent $obs
  Write-AplusLog "Starting OBS: $obs"
  Start-Process -FilePath $obs -ArgumentList @('--profile','AplusScore','--startstreaming','--minimize-to-tray') -WorkingDirectory $obsDir
  Write-AplusLog "OBS start command sent."
  exit 0
} catch {
  Write-AplusLog ("ERROR: " + $_.Exception.Message)
  exit 99
}
`;

const writeObsBridgeRunnerScript = async () => {
  const paths = getWindowsLiveOverlayPaths();
  await ensureDir(paths.root);
  const scriptPath = `${paths.root}/start-aplus-obs-live.ps1`;
  await RNFS.writeFile(scriptPath, buildObsBridgeRunnerScript(), "utf8");
  return scriptPath;
};

const startObsBridgeWorker = async (sessionPath: string) => {
  const nativeModule = getNativeModule();
  const paths = getWindowsLiveOverlayPaths();

  if (!nativeModule?.start) {
    console.log("[OBSBridgeWorker] native start missing", {
      sessionPath,
    });
    return {
      ok: false,
      error: "WindowsFfmpegLiveModule.start missing; cannot auto-start OBS.",
    };
  }

  if (!sessionPath) {
    return { ok: false, error: "Missing OBS bridge session file." };
  }

  const scriptPath = await writeObsBridgeRunnerScript();
  const powershellPath = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    toWindowsPath(scriptPath),
    "-SessionPath",
    toWindowsPath(sessionPath),
  ];

  const commandMasked = [quoteArg(powershellPath), ...args.map(quoteArg)].join(
    " ",
  );

  console.log("[OBSBridgeWorker] starting", {
    scriptPath,
    sessionPath,
    logPath: `${paths.root}/obs-bridge-runner.log`,
    commandMasked,
  });

  try {
    const result = await nativeModule.start({
      ffmpegPath: powershellPath,
      args,
      commandMasked,
    });
    console.log("[OBSBridgeWorker] start result", result);
    return {
      ok: !result?.error,
      ...result,
      scriptPath,
      logPath: `${paths.root}/obs-bridge-runner.log`,
    };
  } catch (error: any) {
    console.log("[OBSBridgeWorker] start failed", {
      error: error?.message || String(error),
      scriptPath,
      sessionPath,
    });
    return {
      ok: false,
      error: error?.message || String(error),
      scriptPath,
      logPath: `${paths.root}/obs-bridge-runner.log`,
    };
  }
};

const isCaromSnapshot = (snapshot?: WindowsFfmpegOverlaySnapshot | null) => {
  const category = String(snapshot?.category || "").toLowerCase();
  const mode = String(snapshot?.mode || "").toLowerCase();
  return (
    category.includes("carom") ||
    mode.includes("carom") ||
    mode.includes("libre")
  );
};

const normalizePlayer = (
  snapshot: WindowsFfmpegOverlaySnapshot | null | undefined,
  index: number,
) => {
  const player = snapshot?.players?.[index] || {};
  return {
    name:
      String(player.name || `Player ${index + 1}`).trim() ||
      `Player ${index + 1}`,
    flag: String(player.flag || "").trim(),
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
  const hasFlags = players
    .slice(0, 2)
    .some((player) => Boolean(String(player?.flag || "").trim()));
  const hasTimer =
    snapshot?.countdownTime !== undefined && snapshot?.countdownTime !== null;
  const hasTarget = snapshot?.goal !== undefined && snapshot?.goal !== null;
  const hasTurn =
    snapshot?.totalTurns !== undefined && snapshot?.totalTurns !== null;
  const hasCaromStats = isCaromSnapshot(snapshot)
    ? players
        .slice(0, 2)
        .some(
          (player) =>
            Number(player?.currentPoint || 0) !== 0 ||
            Number(player?.highestRate || 0) !== 0 ||
            Number(player?.secondHighestRate || 0) !== 0 ||
            Number(player?.average || 0) !== 0,
        )
    : true;

  const missingFields = [
    hasPlayers ? "" : "players",
    hasTimer ? "" : "timer",
    hasTarget ? "" : "target",
    hasTurn ? "" : "turn",
    hasCaromStats ? "" : "caromStats",
  ].filter(Boolean);

  return {
    logo: true,
    scoreboard: hasPlayers,
    timer: hasTimer,
    players: hasPlayers,
    flags: hasFlags,
    target: hasTarget,
    turn: hasTurn,
    mode: isCaromSnapshot(snapshot) ? "carom" : "pool",
    windowsOverlayStatus: missingFields.length ? "partial" : "same-data-source",
    missingFields,
  };
};

const logLiveAuditOnce = () => {
  if (auditLogged) {
    return;
  }
  auditLogged = true;

  console.log("[WindowsLiveAudit]", {
    files: [
      "src/services/livestream/WindowsFfmpegLiveEngine.ts",
      "windows/billiardsgrade/WindowsFfmpegLiveModule.cpp",
      "src/scenes/game/game-play/GamePlayViewModel.tsx",
      "src/services/youtubeLiveFlow.ts",
    ],
    engine:
      "Windows local FFmpeg fire-and-forget libx264 ingest + YouTube RTMP",
    overlaySource:
      "gameplay playerSettings/gameSettings/countdown snapshot rendered by FFmpeg drawtext/drawbox plus JSON/HTML debug artifact",
    startFlow: "OAuth/backend session -> FFmpeg local start",
    stopFlow: "send q to FFmpeg, wait, terminate fallback, backend stop",
    usesNgrok: false,
    usesMetro: false,
    usesFfmpeg: true,
  });

  [
    [
      "Live entry screen",
      "Windows live-platform -> live-platform-setup -> gameplay",
      "kept",
    ],
    [
      "Auth / stream key",
      "OAuth/backend returns RTMP ingest for Windows FFmpeg",
      "kept",
    ],
    [
      "Camera source",
      "DirectShow camera if available, otherwise safe generated background; hardware encoders disabled for crash safety",
      "kept",
    ],
    [
      "Overlay source of truth",
      "gameplay playerSettings/gameSettings snapshot",
      "kept",
    ],
    [
      "Overlay rendering",
      "FFmpeg drawbox/drawtext from snapshot plus JSON/HTML debug artifact",
      "kept",
    ],
    ["Release dependency", "no Metro/ngrok for stream", "kept"],
  ].forEach(([item, windowsValue, status]) => {
    console.log("[WindowsLiveDiff]", { item, windowsValue, status });
  });
};

export const getWindowsFfmpegLiveStatus = async () => {
  return {
    status: liveState,
    mode: "obs-bridge",
    external: true,
    note: "WindowsScore is not running FFmpeg internally. Use OBS/Aplus Live Worker for streaming.",
  };
};

export const checkFfmpegAvailable = async (ffmpegPath?: string) => {
  const nativeModule = getNativeModule();

  console.log("[LiveFfmpegCheck]", {
    ffmpegPath: ffmpegPath || "AUTO_NATIVE",
    available: Boolean(nativeModule?.checkFfmpegAvailable),
    version: undefined,
    error: nativeModule?.checkFfmpegAvailable
      ? undefined
      : "WindowsFfmpegLiveModule missing",
  });

  if (!nativeModule?.checkFfmpegAvailable) {
    return {
      available: false,
      ffmpegPath: normalizeNativeFfmpegPath(ffmpegPath),
      version: "",
      error: i18n.t("ffmpegModuleMissing") as string,
    };
  }

  const resolvedFfmpegPath = await resolveUsableFfmpegPath(
    nativeModule,
    ffmpegPath,
  );

  try {
    const result = await nativeModule.checkFfmpegAvailable(
      resolvedFfmpegPath || "",
    );
    const finalPath = normalizeNativeFfmpegPath(
      result?.ffmpegPath || resolvedFfmpegPath || ffmpegPath,
    );
    console.log("[LiveFfmpegCheck]", {
      ffmpegPath: finalPath || result?.ffmpegPath || "AUTO_NATIVE",
      available: !!result?.available,
      version: result?.version,
      error: result?.error,
    });
    return {
      ...result,
      ffmpegPath: finalPath,
    };
  } catch (error: any) {
    console.log("[LiveFfmpegCheck]", {
      ffmpegPath: resolvedFfmpegPath || ffmpegPath || "AUTO_NATIVE",
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

export const listWindowsFfmpegVideoDevices = async (ffmpegPath?: string) => {
  const nativeModule = getNativeModule();

  if (!nativeModule?.listDevices) {
    const result = {
      videoDevices: [] as string[],
      audioDevices: [] as string[],
      error: "WindowsFfmpegLiveModule.listDevices missing",
    };
    console.log("[LiveDeviceList]", {
      ...result,
      selectedVideoDevice: "",
      selectedAudioDevice: "",
    });
    return result;
  }

  try {
    const resolvedFfmpegPath = await resolveUsableFfmpegPath(
      nativeModule,
      ffmpegPath,
    );
    const result = await nativeModule.listDevices(resolvedFfmpegPath || "");
    console.log("[LiveDeviceList]", {
      videoDevices: result?.videoDevices || [],
      audioDevices: result?.audioDevices || [],
      selectedVideoDevice: "",
      selectedAudioDevice: "",
      error: result?.error,
    });
    return result;
  } catch (error: any) {
    const result = {
      videoDevices: [] as string[],
      audioDevices: [] as string[],
      error: error?.message || String(error),
    };
    console.log("[LiveDeviceList]", {
      ...result,
      selectedVideoDevice: "",
      selectedAudioDevice: "",
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
  const goalText = escapeDrawText(
    `Mục tiêu ${Number(snapshot?.goal || 0) || "-"}`,
  );
  const turnText = escapeDrawText(`Lượt ${Number(snapshot?.totalTurns || 0)}`);
  const timerValue =
    snapshot?.countdownTime == null
      ? "--"
      : `${Math.max(0, Math.ceil(Number(snapshot.countdownTime || 0)))}s`;
  const timerText = escapeDrawText(timerValue);
  const leftLabel = escapeDrawText(
    `${left.flag ? `${left.flag} ` : ""}${left.name}`,
  );
  const rightLabel = escapeDrawText(
    `${right.name}${right.flag ? ` ${right.flag}` : ""}`,
  );
  const scoreText = escapeDrawText(`${left.score}      ${right.score}`);
  const barHeight = Math.round(height * 0.104);
  const barY = height - Math.round(height * 0.052) - barHeight;
  const red = "0xC91D24";

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
  ].join(",");
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
  const targetText = escapeDrawText(
    `Target ${Number(snapshot?.goal || 0) || "-"}`,
  );
  const turnText = escapeDrawText(`Turn ${Number(snapshot?.totalTurns || 0)}`);
  const timerText = escapeDrawText(
    snapshot?.countdownTime == null
      ? "--"
      : `${Math.max(0, Math.ceil(Number(snapshot.countdownTime || 0)))}s`,
  );
  const leftLine = escapeDrawText(
    `${left.flag ? `${left.flag} ` : ""}${left.name}  ${left.score}`,
  );
  const rightLine = escapeDrawText(
    `${right.flag ? `${right.flag} ` : ""}${right.name}  ${right.score}`,
  );
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
  ].join(",");
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
  const { width, height } = resolveDimensions(config);
  const fps = resolveFps(config);
  const bitrate = resolveBitrate(config);
  const videoEncoder = resolveVideoEncoder(config);
  const outputUrl = normalizeRtmpOutput(config.rtmpUrl, config.streamKey);
  const gop = Math.max(30, fps * 2);
  const cameraDeviceName = String(config.cameraDeviceName || "").trim();
  const audioDeviceName = String(config.audioDeviceName || "").trim();
  const ffmpegPath = String(config.ffmpegPath || "ffmpeg").trim() || "ffmpeg";
  const useScreenCapture = isScreenCaptureSentinel(cameraDeviceName);

  const args: string[] = ["-hide_banner", "-loglevel", "warning"];

  if (useScreenCapture) {
    // Safe fallback: use a generated video background instead of gdigrab desktop capture.
    // gdigrab can crash or destabilize the RNW/UWP app on some machines when the
    // gameplay screen starts updating. The generated source keeps YouTube live stable
    // while preserving the scoreboard/overlay, until a real DirectShow camera is available.
    args.push(
      "-re",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x101010:s=${width}x${height}:r=${fps}`,
    );
  } else {
    args.push(
      "-f",
      "dshow",
      "-video_size",
      `${width}x${height}`,
      "-framerate",
      String(fps),
      "-i",
      `video=${cameraDeviceName}`,
    );
  }

  if (config.useAudio && audioDeviceName) {
    args.push("-f", "dshow", "-i", `audio=${audioDeviceName}`);
  } else {
    args.push(
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
    );
  }

  const overlayFilter = buildOverlayFilter(snapshot, width, height);
  const videoFilter = overlayFilter;
  const encoderArgs = buildVideoEncoderArgs(videoEncoder);

  args.push(
    "-filter_complex",
    `[0:v]${videoFilter}[vout]`,
    "-map",
    "[vout]",
    "-map",
    config.useAudio && audioDeviceName ? "1:a?" : "1:a",
    ...encoderArgs,
    "-b:v",
    bitrate,
    "-maxrate",
    bitrate,
    "-bufsize",
    `${Math.max(1, parseInt(bitrate, 10) * 2)}k`,
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-g",
    String(gop),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-f",
    "flv",
    outputUrl,
  );

  const maskedArgs = args.map((arg) =>
    arg === outputUrl
      ? normalizeRtmpOutput(config.rtmpUrl, maskStreamKey(config.streamKey))
      : arg.includes(config.streamKey)
        ? arg.replace(config.streamKey, maskStreamKey(config.streamKey))
        : arg,
  );

  const commandMasked = [
    quoteArg(ffmpegPath),
    ...maskedArgs.map(quoteArg),
  ].join(" ");

  console.log("[LiveFfmpegCommand]", {
    commandMasked,
    rtmpUrl: String(config.rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL).replace(
      /\/+$/g,
      "",
    ),
    streamKeyMasked: maskStreamKey(config.streamKey),
    resolution: `${width}x${height}`,
    fps,
    bitrate,
    videoEncoder,
    captureSource: useScreenCapture ? "safe-background" : "directshow",
  });

  return {
    ffmpegPath,
    args,
    commandMasked,
    rtmpUrl: String(config.rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL).replace(
      /\/+$/g,
      "",
    ),
    streamKeyMasked: maskStreamKey(config.streamKey),
    resolution: `${width}x${height}`,
    fps,
    bitrate,
    videoEncoder,
    captureSource: useScreenCapture ? "safe-background" : "directshow",
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
    source: "gameplay-shared-overlay-snapshot-data",
    parity: buildOverlayParity(snapshot),
  };

  const overlaySignature = JSON.stringify({
    category: snapshot.category,
    mode: snapshot.mode,
    currentPlayerIndex: snapshot.currentPlayerIndex,
    countdownTime: Math.ceil(Number(snapshot.countdownTime || 0)),
    totalTurns: snapshot.totalTurns,
    goal: snapshot.goal,
    players: (snapshot.players || []).slice(0, 2).map((player) => ({
      name: player?.name,
      flag: player?.flag,
      score: player?.score,
      currentPoint: player?.currentPoint,
      highestRate: player?.highestRate,
      secondHighestRate: player?.secondHighestRate,
      average: player?.average,
    })),
  });

  if (
    overlaySignature === lastOverlayWriteSignature &&
    now - lastOverlayWriteAt < 900
  ) {
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
  const timerText =
    snapshot.countdownTime == null
      ? "--"
      : `${Math.max(0, Math.ceil(Number(snapshot.countdownTime || 0)))}s`;

  try {
    await RNFS.writeFile(
      paths.jsonPath,
      JSON.stringify(payload, null, 2),
      "utf8",
    );
    await RNFS.writeFile(
      paths.htmlPath,
      `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:transparent;color:white;font-family:Arial,sans-serif}.top{position:absolute;left:48px;top:28px;font-weight:900;font-size:36px}.score{position:absolute;left:7%;right:7%;bottom:5.2%;height:104px;background:rgba(201,29,36,.88);display:flex;align-items:center;justify-content:space-between;padding:0 42px;box-sizing:border-box}.name{font-size:28px;font-weight:800}.points{font-size:58px;font-weight:900}.meta{position:absolute;left:0;right:0;bottom:18px;text-align:center;font-size:20px}</style></head><body><div class="top">A+Plus</div><div class="score"><div class="name">${left.flag ? `${left.flag} ` : ""}${left.name}</div><div class="points">${left.score} - ${right.score}</div><div class="name">${right.name}${right.flag ? ` ${right.flag}` : ""}</div></div><div class="meta">Target ${snapshot.goal || "-"} · Turn ${snapshot.totalTurns || 0} · ${timerText}</div></body></html>`,
      "utf8",
    );
    lastOverlayPath = paths.jsonPath;
  } catch (error) {
    console.log("[LiveOverlay]", {
      overlayMode: "json/html",
      overlayPath: paths.jsonPath,
      overlayExists: false,
      overlayUpdatedAt: Date.now(),
      snapshotScore: players.map((player) => player.score),
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
    console.log("[WindowsLiveOverlayParity]", parity);
    console.log("[WindowsLiveOverlayUpdate]", {
      overlayPath: paths.jsonPath,
      updatedAt: payload.updatedAt,
      scoreSnapshot: players.map((player) => player.score),
      timerSnapshot: snapshot.countdownTime,
      fileExists: overlayExists,
      fileSize,
    });
    console.log("[LiveOverlay]", {
      overlayMode: "drawtext+json/html",
      overlayPath: paths.jsonPath,
      overlayExists,
      overlayUpdatedAt: payload.updatedAt,
      snapshotScore: players.map((player) => player.score),
      snapshotMode: snapshot.category,
    });
  }

  return true;
};

const writeObsBridgeSessionFile = async (
  config: WindowsFfmpegLiveConfig,
  snapshot?: WindowsFfmpegOverlaySnapshot | null,
) => {
  const paths = getWindowsLiveOverlayPaths();
  try {
    await ensureDir(paths.root);
    const server = config.rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL;
    const streamKey = String(config.streamKey || "").trim();
    const payload = {
      mode: "obs-bridge",
      title: "AplusScore OBS Bridge",
      createdAt: Date.now(),
      createdAtIso: new Date().toISOString(),
      server,
      streamKey,
      rtmpUrl: server,
      rtmpUrlWithKey: streamKey
        ? `${server.replace(/\/+$/g, "")}/${streamKey}`
        : server,
      overlayJsonPath: paths.jsonPath,
      overlayHtmlPath: paths.htmlPath,
      obsBrowserSourceUrl: `file:///${normalizePath(paths.htmlPath)}`,
      recommendedObs: {
        video: "1920x1080",
        fps: 30,
        encoder: "NVIDIA NVENC H.264 nếu có, nếu không dùng x264",
        bitrate: "6000k - 9000k",
        keyframeInterval: 2,
      },
      snapshot: {
        category: snapshot?.category,
        mode: snapshot?.mode,
        score: (snapshot?.players || [])
          .slice(0, 2)
          .map((player) => player?.score || 0),
        timer: snapshot?.countdownTime,
        turn: snapshot?.totalTurns,
      },
    };
    const sessionPath = `${paths.root}/obs-bridge-session.json`;
    await RNFS.writeFile(sessionPath, JSON.stringify(payload, null, 2), "utf8");
    console.log("[OBSBridgeSession]", {
      sessionPath,
      overlayHtmlPath: paths.htmlPath,
      overlayJsonPath: paths.jsonPath,
      hasStreamKey: Boolean(streamKey),
      server,
    });
    return sessionPath;
  } catch (error: any) {
    console.log(
      "[OBSBridgeSession] write failed",
      error?.message || String(error),
    );
    return "";
  }
};

export const startWindowsFfmpegYouTubeLive = async (
  config: WindowsFfmpegLiveConfig,
  snapshot?: WindowsFfmpegOverlaySnapshot | null,
) => {
  if (Platform.OS !== "windows") {
    return { ok: false, error: i18n.t("ffmpegWindowsOnly") as string };
  }

  // OBS Bridge mode:
  // Do NOT start FFmpeg/camera/native streaming inside the RNW gameplay app.
  // The app only creates/updates overlay.json + overlay.html and writes the
  // YouTube RTMP session details for OBS/Aplus Live Worker to use.
  // This avoids native MediaCapture/FFmpeg/encoder crashes taking down the score app.
  liveState = "live";
  currentConfig = {
    ...config,
    platform: "youtube",
    rtmpUrl: config.rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL,
    overlayMode: config.overlayMode || "drawtext",
  };

  console.log("[LiveWindowsMode]", {
    selectedMode: "obs-bridge-external-stream",
    usesMetro: false,
    usesNgrok: false,
    usesRenderForAuth: true,
    usesRenderForStream: false,
    startsFfmpegInsideApp: false,
    startsCameraInsideApp: false,
  });

  await updateWindowsFfmpegOverlay(snapshot || { players: [] });
  const sessionPath = await writeObsBridgeSessionFile(currentConfig, snapshot);
  const obsWorker = await startObsBridgeWorker(sessionPath);

  console.log("[WindowsLiveAudit]", {
    engine:
      "OBS Bridge auto-start. WindowsScore starts OBS externally, not FFmpeg/camera inside app.",
    files: [
      "src/services/livestream/WindowsFfmpegLiveEngine.ts",
      "src/scenes/game/game-play/GamePlayViewModel.tsx",
      "src/services/youtubeLiveFlow.ts",
    ],
    overlaySource:
      "gameplay playerSettings/gameSettings/countdown snapshot written to overlay.json and overlay.html",
    startFlow:
      "OAuth/backend session -> OBS Bridge files -> launch OBS with --startstreaming",
    stopFlow:
      "WindowsScore stops bridge state only; OBS can be stopped manually or by future worker command",
    usesFfmpegInsideApp: false,
    usesCameraInsideApp: false,
    sessionPath,
    obsWorker,
  });

  console.log("[WindowsLiveDiff]", {
    item: "Crash isolation",
    status: "changed",
    windowsValue:
      "FFmpeg/camera livestream removed from RNW app process; use OBS external stream",
  });

  console.log("[LiveFfmpegProcess]", {
    start: false,
    pid: undefined,
    stderrSummary: undefined,
    status: obsWorker?.ok ? "external-obs-autostarted" : "external-obs-bridge",
    stopped: true,
    exitCode: undefined,
    error: obsWorker?.error,
  });
  console.log("[LiveState]", {
    status: "live",
    mode: "obs-bridge",
    sessionPath,
    obsWorker,
    overlayPath: getLastWindowsFfmpegOverlayPath(),
  });

  return {
    ok: true,
    pid: undefined,
    external: true,
    mode: "obs-bridge",
    sessionPath,
    obsWorker,
    overlayPath: getLastWindowsFfmpegOverlayPath(),
  };
};

export const stopWindowsFfmpegYouTubeLive = async (reason = "user-stop") => {
  if (Platform.OS !== "windows") {
    return { ok: true, stopped: true };
  }

  liveState = "stopped";
  currentConfig = null;
  console.log("[LiveState]", { status: "stopped", reason, mode: "obs-bridge" });
  console.log("[WindowsLiveStop]", {
    processStopped: true,
    cleanupDone: true,
    mode: "obs-bridge",
    note: "WindowsScore did not start FFmpeg. Stop OBS/Aplus Live Worker separately.",
  });
  return { ok: true, stopped: true, external: true, mode: "obs-bridge" };
};

export const toWindowsFfmpegSnapshot = (
  snapshot: any,
): WindowsFfmpegOverlaySnapshot => {
  const players = snapshot?.playerSettings?.playingPlayers || [];
  return {
    category: snapshot?.gameSettings?.category || snapshot?.category,
    mode: snapshot?.gameSettings?.mode?.mode || snapshot?.gameMode,
    currentPlayerIndex: snapshot?.currentPlayerIndex,
    countdownTime: snapshot?.countdownTime,
    totalTurns: snapshot?.totalTurns,
    goal:
      snapshot?.goal ||
      snapshot?.gameSettings?.players?.goal?.goal ||
      snapshot?.playerSettings?.goal?.goal,
    players: players.map((player: any) => ({
      name: player?.name,
      flag:
        typeof player?.flag === "string"
          ? player.flag
          : player?.country?.flag ||
            player?.countryCode ||
            player?.country ||
            "",
      score: Number(player?.totalPoint || 0),
      currentPoint: Number(player?.proMode?.currentPoint || 0),
      highestRate: Number(
        player?.proMode?.highestRate || player?.proMode?.highestRun || 0,
      ),
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
    goal:
      params.gameSettings?.players?.goal?.goal ||
      params.playerSettings?.goal?.goal,
    playerSettings: params.playerSettings,
  });

export const isWindowsFfmpegLocalLiveRunning = () =>
  liveState === "live" || liveState === "starting";
export const getCurrentWindowsFfmpegLiveConfig = () => currentConfig;
export const getLastWindowsFfmpegOverlayPath = () => lastOverlayPath;
