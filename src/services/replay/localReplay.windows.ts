import RNFS from 'react-native-fs';

export const RECORDING_SEGMENT_DURATION_MS = 30 * 1000;
export const MAX_REPLAY_STORAGE_BYTES = 2 * 1024 * 1024 * 1024;
export const VIDEO_STORAGE_CLEANUP_THRESHOLD_BYTES = 1536 * 1024 * 1024;
export const REPLAY_WINDOW_SEGMENTS = 2;
export const REPLAY_WINDOW_SECONDS = 60;
export const MIN_VALID_SEGMENT_DURATION_MS = 1000;

export const WINDOWS_VIDEO_FOLDER_NAME = 'Aplus Score';
const WINDOWS_USERPROFILE_DIR = String((globalThis as any)?.process?.env?.USERPROFILE || '').replace(/\\/g, '/');
const WINDOWS_USERNAME = String((globalThis as any)?.process?.env?.USERNAME || '').replace(/[^A-Za-z0-9._-]+/g, '');
export const WINDOWS_VIDEO_PRIMARY_BASE_DIR = WINDOWS_USERPROFILE_DIR
  ? `${WINDOWS_USERPROFILE_DIR}/Videos/${WINDOWS_VIDEO_FOLDER_NAME}`
  : WINDOWS_USERNAME
    ? `C:/Users/${WINDOWS_USERNAME}/Videos/${WINDOWS_VIDEO_FOLDER_NAME}`
    : `Videos/${WINDOWS_VIDEO_FOLDER_NAME}`;
export const HISTORY_FOLDER_NAME = 'History';
export const REPLAY_TEMP_FOLDER_NAME = 'ReplayTemp';
export const REPLAY_TEMP_CURRENT_FOLDER_NAME = '';

export const REPLAY_ROOT = `${WINDOWS_VIDEO_PRIMARY_BASE_DIR}/${REPLAY_TEMP_FOLDER_NAME}`;
export const ARCHIVE_ROOT = `${WINDOWS_VIDEO_PRIMARY_BASE_DIR}/${HISTORY_FOLDER_NAME}`;

const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.ts'];
const MATCH_MANIFEST_FILE_NAME = 'metadata.json';

type ReadDirItem = {
  ctime?: Date;
  mtime?: Date;
  name: string;
  path: string;
  size: number;
  createdAtMs?: number;
  isFile: () => boolean;
  isDirectory: () => boolean;
};

export type ReplaySegmentEntry = {
  segmentIndex: number;
  fileName: string;
  path: string;
  replayTempPath?: string;
  createdAt: number;
  finalizedAt?: number;
  durationSeconds?: number;
  sizeBytes: number;
};

export type ReplayMatchManifest = {
  version: number;
  matchId: string;
  webcamFolderName: string;
  matchFolderName: string;
  mode?: string;
  playerNames?: string[];
  startTime: string;
  endTime?: string;
  segmentDurationMinutes: number;
  status: 'recording' | 'completed' | 'interrupted';
  keepFullMatch: boolean;
  createdAt: number;
  updatedAt: number;
  exportedAt?: number;
  totalSizeBytes: number;
  finalVideoPath?: string;
  durationMs?: number;
  finalScore?: number[];
  winnerName?: string;
  finalPlayers?: any[];
  finalTurn?: number;
  overlayTimelinePath?: string;
  finalResultSavedAt?: number;
  segments: ReplaySegmentEntry[];
};

export type HistoryMatchEntry = {
  webcamFolderName: string;
  folderName: string;
  folderPath: string;
  manifest?: ReplayMatchManifest;
  files: ReadDirItem[];
  createdAt: number;
  updatedAt: number;
  totalSizeBytes: number;
};

export type RegisterReplaySegmentOptions = {
  keepFullMatch?: boolean;
  matchSessionId?: string;
  segmentIndex?: number;
  mode?: string;
  playerNames?: string[];
  segmentStartedAt?: number;
  durationSeconds?: number;
  nativeStartResolvedAtMs?: number;
  nativeStopResolvedAtMs?: number;
  fileSize?: number;
};

export type BuildWindowsRecordingOutputPathOptions = {
  webcamFolderName: string;
  segmentIndex?: number;
  matchSessionId?: string;
};

export type ExportMatchArchiveOptions = {
  finalScore?: number[];
  winnerName?: string;
  finalPlayers?: any[];
  finalTurn?: number;
  endedAt?: number;
  durationMs?: number;
  overlayTimelinePath?: string;
};

const manifests = new Map<string, ReplayMatchManifest>();
let activeBaseDir: string | null = null;
let didCleanupStaleReplayTemp = false;

const normalizePath = (path?: string | null) =>
  String(path || '').replace(/\\/g, '/').replace(/\/+$/g, '');

const sanitizeWindowsName = (value?: string | number | null) => {
  const raw = String(value || '').trim();
  return (
    raw
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 120) || `match_${Date.now()}`
  );
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const formatDateForFolder = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}_${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`;

const folderNameFromWebcam = (webcamFolderName: string) => {
  const numeric = Number(webcamFolderName);
  const date =
    Number.isFinite(numeric) && numeric > 1000000000
      ? new Date(numeric)
      : new Date();
  const prefix = Number.isNaN(date.getTime()) ? formatDateForFolder(new Date()) : formatDateForFolder(date);
  const suffix = sanitizeWindowsName(webcamFolderName);

  return `match_${prefix}_${suffix}`;
};

const basename = (filePath?: string | null) => {
  const target = normalizePath(filePath);
  return target.split('/').filter(Boolean).pop() || `segment_${Date.now()}.mp4`;
};

const dirname = (filePath?: string | null) => {
  const target = normalizePath(filePath);
  return target.replace(/\/[^/]+$/g, '');
};

const videoExtensionFromPath = (filePath?: string | null) => {
  const match = String(filePath || '').toLowerCase().match(/\.(mov|mp4|m4v|ts)$/);
  return match ? `.${match[1]}` : '.mp4';
};

const isVideoFile = (name?: string | null) => {
  const lower = String(name || '').toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
};

const safeMtime = (item: ReadDirItem) => {
  const raw = item.mtime ? new Date(item.mtime).getTime() : 0;
  return Number.isFinite(raw) ? raw : 0;
};

const ensureDir = async (folderPath: string, label = 'folder') => {
  const normalized = normalizePath(folderPath);
  const existedBefore = await RNFS.exists(normalized);

  if (!existedBefore) {
    await RNFS.mkdir(normalized);
  }

  const existsAfter = await RNFS.exists(normalized);
  console.log('[WindowsVideoPath]', {
    label,
    folder: normalized,
    folderExists: existsAfter,
    createFolderResult: existedBefore ? 'already-exists' : 'created',
  });

  return normalized;
};

const parentDir = (folderPath: string) => {
  const normalized = normalizePath(folderPath);
  return normalized.replace(/\/[^/]+$/g, '');
};

const readWindowsVideosBaseDir = async () => {
  const helper = RNFS as any;

  if (typeof helper.getVideosBaseDir === 'function') {
    const videosBaseDir = normalizePath(await helper.getVideosBaseDir());
    if (videosBaseDir) {
      return videosBaseDir;
    }
  }

  if (typeof helper.getFallbackBaseDir === 'function') {
    const fallbackDir = normalizePath(await helper.getFallbackBaseDir());
    if (fallbackDir) {
      return fallbackDir;
    }
  }

  return WINDOWS_VIDEO_PRIMARY_BASE_DIR;
};

const ensureBaseAt = async (baseDir: string) => {
  const normalized = normalizePath(baseDir);
  const videosDir = parentDir(normalized);
  const replayDir = `${normalized}/${REPLAY_TEMP_FOLDER_NAME}`;
  const historyDir = `${normalized}/${HISTORY_FOLDER_NAME}`;

  console.log('[WindowsVideoPath]', {
    videosDir,
    aplusDir: normalized,
    replayDir,
    historyDir,
  });

  await ensureDir(normalized, 'aplusDir');
  await ensureDir(replayDir, 'replayDir');
  await ensureDir(historyDir, 'historyDir');

  return normalized;
};

export const ensureReplayRoot = async () => {
  if (activeBaseDir) {
    return activeBaseDir;
  }

  const requestedBaseDir = await readWindowsVideosBaseDir();

  console.log('[VideoStorage] baseDir', requestedBaseDir);
  console.log('[WindowsVideoStorage] baseDir =', requestedBaseDir);

  try {
    activeBaseDir = await ensureBaseAt(requestedBaseDir);
    console.log('[WindowsVideoStorage] ensureDir ok =', true);
  } catch (error) {
    console.log('[WindowsVideoStorage] ensureDir ok =', false);
    console.log('[WindowsVideoStorage] ensureDir error =', error);
    console.log('[WindowsVideoPath]', {
      createFolderResult: 'failed',
      permissionDenied: true,
      reason: 'videosLibrary-storage-api-failed',
      requestedBaseDir,
    });
    console.log('[HistoryRecorder] recorderStartBlocked reason=videosLibrary-storage-api-failed');
    throw error;
  }

  console.log('[VideoStorage] replayTempDir', `${activeBaseDir}/${REPLAY_TEMP_FOLDER_NAME}`);
  console.log('[VideoStorage] historyDir', `${activeBaseDir}/${HISTORY_FOLDER_NAME}`);

  return activeBaseDir;
};

const getReplayTempRoot = async () =>
  `${await ensureReplayRoot()}/${REPLAY_TEMP_FOLDER_NAME}`;

const getHistoryRoot = async () => `${await ensureReplayRoot()}/${HISTORY_FOLDER_NAME}`;

export const getWindowsVideoBaseDir = ensureReplayRoot;

export const buildReplayFolderPath = (webcamFolderName: string) => {
  return `${REPLAY_ROOT}/${folderNameFromWebcam(webcamFolderName)}`;
};

export const buildArchiveFolderPath = (webcamFolderName: string) => {
  return `${ARCHIVE_ROOT}/${folderNameFromWebcam(webcamFolderName)}`;
};

export const buildLegacyReplayFolderPath = buildReplayFolderPath;

const resolveMatchFolderPath = async (rootPath: string, webcamFolderName: string) => {
  const expectedPath = `${rootPath}/${folderNameFromWebcam(webcamFolderName)}`;

  if (await RNFS.exists(expectedPath)) {
    return expectedPath;
  }

  const directPath = `${rootPath}/${sanitizeWindowsName(webcamFolderName)}`;
  if (await RNFS.exists(directPath)) {
    return directPath;
  }

  return expectedPath;
};

const getReplayFolderPath = async (webcamFolderName: string) =>
  resolveMatchFolderPath(await getReplayTempRoot(), webcamFolderName);

const getHistoryFolderPath = async (webcamFolderName: string) =>
  resolveMatchFolderPath(await getHistoryRoot(), webcamFolderName);

const getMetadataPath = async (webcamFolderName: string) =>
  `${await getHistoryFolderPath(webcamFolderName)}/${MATCH_MANIFEST_FILE_NAME}`;

const toSegmentFileName = (segmentIndex: number, extension = '.mp4') => {
  const safeExtension = VIDEO_EXTENSIONS.includes(extension.toLowerCase()) ? extension.toLowerCase() : '.mp4';
  return `segment_${String(Math.max(0, segmentIndex) + 1).padStart(4, '0')}${safeExtension}`;
};

const toReplayTempFileName = (segmentIndex: number, extension = '.mp4') => {
  const safeExtension = VIDEO_EXTENSIONS.includes(extension.toLowerCase()) ? extension.toLowerCase() : '.mp4';
  return `replay_part_${String(Math.max(0, segmentIndex) + 1).padStart(3, '0')}${safeExtension}`;
};

const readVideoFiles = async (folderPath: string, includeZeroSize = false) => {
  try {
    const normalized = normalizePath(folderPath);
    if (!(await RNFS.exists(normalized))) {
      return [] as ReadDirItem[];
    }

    const items = (await RNFS.readDir(normalized)) as ReadDirItem[];
    return items
      .filter(item => item.isFile() && isVideoFile(item.name))
      .filter(item => includeZeroSize || Number(item.size || 0) > 0)
      .sort((a, b) => safeMtime(a) - safeMtime(b));
  } catch (error) {
    console.log('[Replay] video discovery error:', {folderPath, error});
    return [] as ReadDirItem[];
  }
};

const readChildDirectories = async (folderPath: string) => {
  try {
    if (!(await RNFS.exists(folderPath))) {
      return [] as ReadDirItem[];
    }

    const items = (await RNFS.readDir(folderPath)) as ReadDirItem[];
    return items.filter(item => item.isDirectory()).sort((a, b) => safeMtime(a) - safeMtime(b));
  } catch (error) {
    console.log('[VideoStorage] read dirs failed', {folderPath, error});
    return [] as ReadDirItem[];
  }
};

const getFileSize = async (filePath: string) => {
  try {
    const stat = await RNFS.stat(filePath);
    return Number(stat.size || 0);
  } catch {
    return 0;
  }
};

const getDirectorySize = async (folderPath: string): Promise<number> => {
  try {
    if (!(await RNFS.exists(folderPath))) {
      return 0;
    }

    const items = (await RNFS.readDir(folderPath)) as ReadDirItem[];
    let total = 0;

    for (const item of items) {
      if (item.isDirectory()) {
        total += await getDirectorySize(item.path);
      } else {
        total += Number(item.size || 0);
      }
    }

    return total;
  } catch (error) {
    console.log('[VideoStorage] directory size failed', {folderPath, error});
    return 0;
  }
};

const createManifest = (webcamFolderName: string): ReplayMatchManifest => {
  const now = Date.now();

  return {
    version: 2,
    matchId: webcamFolderName,
    webcamFolderName,
    matchFolderName: folderNameFromWebcam(webcamFolderName),
    startTime: new Date(now).toISOString(),
    segmentDurationMinutes: RECORDING_SEGMENT_DURATION_MS / 60000,
    status: 'recording',
    keepFullMatch: true,
    createdAt: now,
    updatedAt: now,
    totalSizeBytes: 0,
    segments: [],
  };
};

const normalizeManifest = (webcamFolderName: string, value?: Partial<ReplayMatchManifest> | null): ReplayMatchManifest => {
  const fallback = createManifest(webcamFolderName);
  const merged = {
    ...fallback,
    ...(value || {}),
    version: 2,
    webcamFolderName,
    matchFolderName: value?.matchFolderName || folderNameFromWebcam(webcamFolderName),
    segmentDurationMinutes: RECORDING_SEGMENT_DURATION_MS / 60000,
    status: (value?.status as any) || fallback.status,
    segments: Array.isArray(value?.segments) ? value!.segments! : [],
  };

  merged.totalSizeBytes = merged.segments.reduce((sum, segment) => sum + Number(segment.sizeBytes || 0), 0);
  return merged;
};

const loadManifestFromDisk = async (webcamFolderName: string) => {
  const metadataPath = await getMetadataPath(webcamFolderName);

  if (!(await RNFS.exists(metadataPath))) {
    return undefined;
  }

  try {
    const raw = await RNFS.readFile(metadataPath);
    return normalizeManifest(webcamFolderName, JSON.parse(raw));
  } catch (error) {
    console.log('[HistoryVideo] metadata read failed', {metadataPath, error});
    return undefined;
  }
};

const getManifest = async (webcamFolderName: string) => {
  if (manifests.has(webcamFolderName)) {
    return manifests.get(webcamFolderName)!;
  }

  const diskManifest = await loadManifestFromDisk(webcamFolderName);
  const manifest = diskManifest || createManifest(webcamFolderName);
  manifests.set(webcamFolderName, manifest);
  return manifest;
};

const saveManifest = async (webcamFolderName: string, manifest: ReplayMatchManifest) => {
  const historyFolder = await ensureArchiveFolder(webcamFolderName);
  const metadataPath = `${historyFolder}/${MATCH_MANIFEST_FILE_NAME}`;
  const totalSizeBytes = manifest.segments.reduce((sum, segment) => sum + Number(segment.sizeBytes || 0), 0);

  const payload: ReplayMatchManifest = {
    ...manifest,
    totalSizeBytes,
    updatedAt: Date.now(),
  };

  manifests.set(webcamFolderName, payload);
  await RNFS.writeFile(metadataPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log('[HistoryVideo] metadata saved', metadataPath);
  console.log('[VideoStorage] history metadata saved', metadataPath);
  console.log('[History] savedVideoPath =', historyFolder);
  console.log('[HistoryRecorder]', {
    event: 'savedMetadata',
    outputPath: historyFolder,
    savedMetadata: metadataPath,
    fileSize: totalSizeBytes,
  });

  return payload;
};

export const ensureReplayFolder = async (webcamFolderName: string) => {
  const folderPath = await getReplayFolderPath(webcamFolderName);
  await ensureDir(folderPath);
  console.log('[Replay] replay temp folder path', folderPath);
  return folderPath;
};

export const ensureArchiveFolder = async (webcamFolderName: string) => {
  const folderPath = await getHistoryFolderPath(webcamFolderName);
  await ensureDir(folderPath);
  console.log('[VideoStorage] matchDir', folderPath);
  console.log('[HistoryVideo] match folder created', folderPath);
  return folderPath;
};

export const resolveReplayFolder = async (webcamFolderName: string) => {
  const replayFolder = await ensureReplayFolder(webcamFolderName);
  const files = await readVideoFiles(replayFolder);

  if (files.length) {
    return replayFolder;
  }

  return ensureArchiveFolder(webcamFolderName);
};

export const readReplayMatchManifest = async (webcamFolderName: string) => {
  return getManifest(webcamFolderName);
};

export const getNextReplaySegmentIndex = async (webcamFolderName: string) => {
  const manifest = await getManifest(webcamFolderName);
  const lastSegment = manifest.segments[manifest.segments.length - 1];

  return lastSegment ? lastSegment.segmentIndex + 1 : 0;
};

export const buildWindowsRecordingOutputPath = async (
  options: BuildWindowsRecordingOutputPathOptions,
) => {
  const segmentIndex = Number.isFinite(Number(options.segmentIndex))
    ? Number(options.segmentIndex)
    : await getNextReplaySegmentIndex(options.webcamFolderName);
  const historyFolder = await ensureArchiveFolder(options.webcamFolderName);

  await cleanupStaleReplayTemp([options.webcamFolderName]);
  await pruneReplayStorage(MAX_REPLAY_STORAGE_BYTES, [options.webcamFolderName]);

  const outputFile = `${historyFolder}/${toSegmentFileName(segmentIndex)}`;

  console.log('[WindowsVideoStorage] outputFile =', outputFile);
  console.log('[VideoStorage] segment started', outputFile);
  console.log('[MatchSegmentRecorder]', {
    event: 'start',
    outputPath: outputFile,
    segmentPath: outputFile,
    webcamFolderName: options.webcamFolderName,
    segmentIndex,
    note: 'single segment pipeline: History and Replay consume finalized segments; no double recorder',
  });
  console.log('[HistoryRecorder]', {
    event: 'observe-segment-registry',
    outputPath: outputFile,
    webcamFolderName: options.webcamFolderName,
    segmentIndex,
  });
  console.log('[ReplayRecorder]', {
    event: 'observe-segment-registry',
    outputPath: outputFile,
    segmentPath: outputFile,
    webcamFolderName: options.webcamFolderName,
    segmentIndex,
  });
  console.log('[ReplayBuffer]', {
    event: 'start',
    segmentDuration: RECORDING_SEGMENT_DURATION_MS / 1000,
    targetWindowSeconds: REPLAY_WINDOW_SECONDS,
    currentSegmentPath: outputFile,
  });
  console.log('[HistoryRecording]', {
    event: 'startFullMatch',
    segmentMode: true,
    segmentIndex,
    outputPath: outputFile,
    segmentPath: outputFile,
    segmentStartMs: Date.now(),
  });

  return outputFile;
};

export const extractReplaySegmentIndex = (filePathOrName?: string | null) => {
  const target = String(filePathOrName || '');
  const match = target.match(/(?:segment_|replay_30s_|replay_part_|part_|webcam_)(\d+)/i);

  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number(match[1]);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  // Old webcam_00 files were zero-based. New segment_0001 files are one-based.
  return /(?:segment_|replay_30s_|replay_part_)/i.test(target)
    ? Math.max(0, parsed - 1)
    : Math.max(0, parsed);
};

const enrichFilesWithManifestTimes = async (
  webcamFolderName: string,
  files: ReadDirItem[],
  source: 'replay' | 'history',
) => {
  if (!files.length) {
    return files;
  }

  try {
    const manifest = await getManifest(webcamFolderName);

    return files.map(file => {
      const segmentIndex = extractReplaySegmentIndex(file.name);
      const normalizedFilePath = normalizePath(file.path);
      const segment = manifest.segments.find(item => {
        const candidatePath = source === 'replay'
          ? item.replayTempPath || item.path
          : item.path;

        if (normalizePath(candidatePath) === normalizedFilePath) {
          return true;
        }

        return Number.isFinite(segmentIndex) && item.segmentIndex === segmentIndex;
      });
      const createdAtMs = Number(segment?.createdAt || safeMtime(file) || Date.now());
      const createdAtDate = new Date(createdAtMs);

      console.log('[ReplayTimeFormat]', {
        rawTimestamp: createdAtMs,
        parsedDate: createdAtDate.toString(),
        timezoneOffsetMinutes: createdAtDate.getTimezoneOffset(),
        formattedLocalTime:
          String(createdAtDate.getHours()).padStart(2, '0') +
          ':' +
          String(createdAtDate.getMinutes()).padStart(2, '0'),
        formattedOldWrongTime: createdAtDate.toISOString().slice(11, 16),
        source: segment ? 'createdAtMs' : 'mtime',
        filePath: file.path,
      });

      return {
        ...file,
        createdAtMs,
        ctime: file.ctime || createdAtDate,
        mtime: createdAtDate,
      };
    });
  } catch (error) {
    console.log('[ReplayTimeFormat]', {
      event: 'manifest-time-enrich-failed',
      webcamFolderName,
      source,
      error,
    });
    return files;
  }
};

const copySegmentToReplayTemp = async (
  webcamFolderName: string,
  historySegmentPath: string,
  segmentIndex: number,
) => {
  const replayFolder = await ensureReplayFolder(webcamFolderName);
  const replayPath = `${replayFolder}/${toReplayTempFileName(segmentIndex, videoExtensionFromPath(historySegmentPath))}`;

  try {
    await RNFS.copyFile(historySegmentPath, replayPath);
    const fileExists = await RNFS.exists(replayPath);
    const fileSize = fileExists ? await getFileSize(replayPath) : 0;

    console.log('[VideoStorage] replay buffer ready', replayPath);
    console.log('[ReplayBuffer]', {
      event: 'finalizeSegment',
      finalizedSegmentPath: historySegmentPath,
      finalizedSegmentSize: fileSize,
      latestPlayableReplayPath: fileExists ? replayPath : undefined,
      targetWindowSeconds: REPLAY_WINDOW_SECONDS,
    });
    console.log('[ReplayRecorder]', {
      event: 'stop/finalize',
      outputPath: replayPath,
      segmentPath: historySegmentPath,
      fileExists,
      fileSize,
      latestReplayPath: fileExists ? replayPath : undefined,
    });

    if (!fileExists) {
      console.log('[ReplayRecorder]', {
        event: 'replay-not-ready',
        reason: 'file chưa tồn tại',
        outputPath: replayPath,
        segmentPath: historySegmentPath,
      });
      return undefined;
    }

    if (fileSize <= 0) {
      console.log('[ReplayRecorder]', {
        event: 'replay-size-unknown-accepted',
        reason: 'Windows stat returned 0 but file exists; allow player to open it',
        outputPath: replayPath,
        segmentPath: historySegmentPath,
        fileExists,
        fileSize,
        latestReplayPath: replayPath,
      });
    }
  } catch (error) {
    console.log('[Replay] replay temp copy failed', {
      inputPath: historySegmentPath,
      replayPath,
      error,
    });
    console.log('[ReplayRecorder]', {
      event: 'replay-not-ready',
      reason: 'path sai hoặc copy failed',
      outputPath: replayPath,
      segmentPath: historySegmentPath,
      error,
    });
    return undefined;
  }

  await trimReplayTempFolder(webcamFolderName);
  return replayPath;
};

const trimReplayTempFolder = async (webcamFolderName: string) => {
  const replayFolder = await ensureReplayFolder(webcamFolderName);
  const files = await readVideoFiles(replayFolder);
  const keep = files.slice(-REPLAY_WINDOW_SEGMENTS);
  const keepPaths = new Set(keep.map(file => normalizePath(file.path)));
  console.log('[ReplayBuffer]', {
    event: 'cleanup',
    cleanupKeptPaths: keep.map(file => file.path),
    cleanupDeletedPaths: files.filter(file => !keepPaths.has(normalizePath(file.path))).map(file => file.path),
    targetWindowSeconds: REPLAY_WINDOW_SECONDS,
  });

  for (const file of files) {
    if (keepPaths.has(normalizePath(file.path))) {
      continue;
    }

    try {
      await RNFS.unlink(file.path);
      console.log('[VideoStorage] deleted old file/folder', file.path);
      console.log('[VideoStorage] deleted oldest', file.path);
    } catch (error) {
      console.log('[Replay] cleanup temp fail', {path: file.path, error});
    }
  }
};

export const cleanupBrokenReplayFiles = async (webcamFolderName?: string) => {
  const replayRoot = await getReplayTempRoot();
  const folders = webcamFolderName
    ? [{path: await ensureReplayFolder(webcamFolderName), name: folderNameFromWebcam(webcamFolderName)} as ReadDirItem]
    : await readChildDirectories(replayRoot);

  for (const folder of folders) {
    const files = await readVideoFiles(folder.path, true);
    for (const file of files) {
      if (Number(file.size || 0) <= 0) {
        console.log('[Replay]', {
          event: 'cleanup-skip-size-unknown',
          path: file.path,
          size: Number(file.size || 0),
          reason: 'Windows VideosLibrary stat can briefly report 0 for playable files',
        });
      }
    }
  }
};

const cleanupStaleReplayTemp = async (protectedFolderNames: string[] = []) => {
  if (didCleanupStaleReplayTemp) {
    return;
  }

  didCleanupStaleReplayTemp = true;
  const replayRoot = await getReplayTempRoot();
  const protectedNames = new Set(
    protectedFolderNames.flatMap(name => [name, folderNameFromWebcam(name)]),
  );

  const folders = await readChildDirectories(replayRoot);
  for (const folder of folders) {
    if (protectedNames.has(folder.name)) {
      console.log('[VideoStorage] skip deleting active match/replay file', folder.path);
      continue;
    }

    try {
      await RNFS.unlink(folder.path);
      console.log('[Replay] cleanup temp success', folder.path);
      console.log('[VideoStorage] deleted old file/folder', folder.path);
    } catch (error) {
      console.log('[Replay] cleanup temp fail', {path: folder.path, error});
    }
  }
};

export const listReplayFiles = async (webcamFolderName: string) => {
  const folderPath = await ensureReplayFolder(webcamFolderName);
  const discoveredFiles = await enrichFilesWithManifestTimes(
    webcamFolderName,
    await readVideoFiles(folderPath, true),
    'replay',
  );

  for (const file of discoveredFiles) {
    console.log('[ReplayRecorder]', {
      event: 'discover',
      outputPath: file.path,
      fileExists: true,
      fileSize: Number(file.size || 0),
    });
  }

  const files = discoveredFiles
    .filter(file => file.isFile() && isVideoFile(file.name))
    .slice(-REPLAY_WINDOW_SEGMENTS);

  if (files.length) {
    const estimatedSelectedTotalDuration = Math.min(
      REPLAY_WINDOW_SECONDS,
      files.length * (RECORDING_SEGMENT_DURATION_MS / 1000),
    );
    const reasonIfShorterThanTarget =
      estimatedSelectedTotalDuration < REPLAY_WINDOW_SECONDS
        ? `only ${files.length} finalized replay segment(s) available`
        : undefined;

    console.log('[Replay] selected replay segments', files.map(file => file.path));
    console.log('[Replay] replay duration', `target=${REPLAY_WINDOW_SECONDS}s estimated=${estimatedSelectedTotalDuration}s`);
    console.log('[VideoStorage] replay file selected', files[files.length - 1]?.path);
    console.log('[ReplayRecorder]', {
      event: 'latest',
      latestReplayPath: files[files.length - 1]?.path,
      fileSize: Number(files[files.length - 1]?.size || 0),
    });
    console.log('[ReplayBuffer]', {
      event: 'latestPlayableReplayPath',
      targetWindowSeconds: REPLAY_WINDOW_SECONDS,
      segmentDurationSeconds: RECORDING_SEGMENT_DURATION_MS / 1000,
      finalizedSegmentsCount: discoveredFiles.length,
      selectedSegments: files.map(file => file.path),
      selectedTotalDuration: estimatedSelectedTotalDuration,
      latestPlayableReplayPath: files[files.length - 1]?.path,
      replayDurationMs: estimatedSelectedTotalDuration * 1000,
      reasonIfShorterThanTarget,
      finalizedSegmentSize: Number(files[files.length - 1]?.size || 0),
    });
  } else {
    const zeroFile = discoveredFiles.find(file => Number(file.size || 0) <= 0);
    console.log('[VideoStorage] replay folder has no finalized mp4 yet', folderPath);
    console.log('[ReplayRecorder]', {
      event: 'replay-not-ready',
      reason: zeroFile ? 'file size = 0' : 'no finalized replay mp4 in folder yet',
      folderPath,
      outputPath: undefined,
      fileExists: Boolean(zeroFile),
      fileSize: zeroFile ? Number(zeroFile.size || 0) : 0,
    });
  }

  return files;
};

export const listArchiveFiles = async (webcamFolderName: string) => {
  const folderPath = await ensureArchiveFolder(webcamFolderName);
  return enrichFilesWithManifestTimes(
    webcamFolderName,
    await readVideoFiles(folderPath, true),
    'history',
  );
};

export const listPlayableFiles = async (
  webcamFolderName: string,
  preferArchive = false,
) => {
  if (preferArchive) {
    const archive = await listArchiveFiles(webcamFolderName);
    console.log('[HistoryScreen]', {
      selectedWebcamFolderName: webcamFolderName,
      selectedSource: 'HistoryOnly',
      finalListCount: archive.length,
    });
    return archive;
  }

  const replay = await listReplayFiles(webcamFolderName);
  console.log('[ReplayBuffer]', {
    event: 'latestPlayableReplayPath',
    latestPlayableReplayPath: replay[replay.length - 1]?.path,
    targetWindowSeconds: REPLAY_WINDOW_SECONDS,
  });
  return replay;
};

export const waitForReplayFiles = async (
  webcamFolderName: string,
  minCount = 1,
  timeoutMs = 8000,
) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const files = await listReplayFiles(webcamFolderName);
    if (files.length >= minCount) {
      return files;
    }
    await new Promise(resolve => setTimeout(resolve, 350));
  }

  return listReplayFiles(webcamFolderName);
};

export const registerReplaySegment = async (
  webcamFolderName: string,
  segmentPath: string,
  options: RegisterReplaySegmentOptions = {},
) => {
  const segmentIndex = Number.isFinite(options.segmentIndex)
    ? Number(options.segmentIndex)
    : await getNextReplaySegmentIndex(webcamFolderName);

  const historyFolder = await ensureArchiveFolder(webcamFolderName);
  const inputExtension = videoExtensionFromPath(segmentPath);
  const expectedHistoryPath = `${historyFolder}/${toSegmentFileName(segmentIndex, inputExtension)}`;
  let finalHistoryPath = normalizePath(segmentPath);

  if (normalizePath(finalHistoryPath) !== normalizePath(expectedHistoryPath)) {
    try {
      await RNFS.copyFile(finalHistoryPath, expectedHistoryPath);
      finalHistoryPath = expectedHistoryPath;
      console.log('[HistoryVideo] segment copied into match folder', {
        from: segmentPath,
        to: expectedHistoryPath,
      });
    } catch (error) {
      console.log('[HistoryVideo] segment copy failed, keeping native path', {
        from: segmentPath,
        to: expectedHistoryPath,
        error,
      });
    }
  }

  const fileName = basename(finalHistoryPath);
  const fileExists = await RNFS.exists(finalHistoryPath);
  const sizeBytes = fileExists ? await getFileSize(finalHistoryPath) : 0;
  const now = Date.now();

  console.log('[HistoryRecorder]', {
    event: 'stop/finalize',
    outputPath: finalHistoryPath,
    fileExists,
    fileSize: sizeBytes,
  });

  if (!fileExists) {
    console.log('[HistoryRecorder]', {
      event: 'history-not-ready',
      reason: 'file chưa tồn tại',
      outputPath: finalHistoryPath,
    });
    return undefined;
  }

  const effectiveSizeBytes = sizeBytes > 0 ? sizeBytes : 1;

  if (sizeBytes <= 0) {
    console.log('[HistoryRecorder]', {
      event: 'history-size-unknown-accepted',
      reason: 'Windows stat returned 0 but file exists; keep it in replay/history',
      outputPath: finalHistoryPath,
      fileExists,
      fileSize: sizeBytes,
      effectiveSizeBytes,
    });
  }

  const manifest = await getManifest(webcamFolderName);
  const previousSegment = manifest.segments
    .filter(item => item.segmentIndex < segmentIndex)
    .sort((a, b) => b.segmentIndex - a.segmentIndex)[0];
  const segmentStartMs = Number(options.segmentStartedAt || now);
  const segmentEndMs = now;
  const gapFromPreviousSegmentMs = previousSegment?.finalizedAt
    ? Math.max(0, segmentStartMs - Number(previousSegment.finalizedAt || 0))
    : 0;
  const segmentDurationMs = Math.max(
    0,
    Number(options.durationSeconds || 0) > 0
      ? Number(options.durationSeconds || 0) * 1000
      : segmentEndMs - segmentStartMs,
  );
  const isValidSegment = fileExists && effectiveSizeBytes > 0 && segmentDurationMs >= MIN_VALID_SEGMENT_DURATION_MS;
  const invalidReason = !fileExists
    ? 'file-missing'
    : effectiveSizeBytes <= 0
      ? 'file-size-zero'
      : segmentDurationMs < MIN_VALID_SEGMENT_DURATION_MS
        ? 'duration-under-1000ms'
        : undefined;

  console.log('[SegmentLifecycle]', {
    event: 'finalizeSegment',
    outputPath: finalHistoryPath,
    segmentIndex,
    segmentStartMs,
    segmentEndMs,
    durationMs: segmentDurationMs,
    fileSize: sizeBytes,
    valid: isValidSegment,
    invalidReason,
  });

  console.log('[HistoryRecording]', {
    event: 'finalizeSegment',
    segmentMode: true,
    segmentIndex,
    segmentPath: finalHistoryPath,
    segmentStartMs,
    segmentEndMs,
    segmentDurationMs,
    segmentSize: sizeBytes,
    gapFromPreviousSegmentMs,
    valid: isValidSegment,
    invalidReason,
  });

  if (!isValidSegment) {
    console.log('[HistoryRecorder]', {
      event: 'invalid-segment-skipped',
      outputPath: finalHistoryPath,
      segmentIndex,
      durationMs: segmentDurationMs,
      fileExists,
      fileSize: sizeBytes,
      reason: invalidReason,
    });
    console.log('[ReplayBuild]', {
      event: 'invalidSegmentSkipped',
      targetWindowSeconds: REPLAY_WINDOW_SECONDS,
      invalidSegmentsCount: 1,
      selectedSegments: [],
      selectedTotalDurationMs: 0,
      reasonIfShort: invalidReason,
    });
    return undefined;
  }

  const replayTempPath = await copySegmentToReplayTemp(
    webcamFolderName,
    finalHistoryPath,
    segmentIndex,
  );

  manifest.matchId = options.matchSessionId || manifest.matchId || webcamFolderName;
  manifest.keepFullMatch = true;
  manifest.status = 'recording';
  manifest.finalVideoPath = finalHistoryPath;
  manifest.mode = options.mode || manifest.mode;
  manifest.playerNames = options.playerNames?.length ? options.playerNames : manifest.playerNames;
  manifest.updatedAt = now;
  manifest.segments = [
    ...manifest.segments.filter(item => item.segmentIndex !== segmentIndex),
    {
      segmentIndex,
      fileName,
      path: finalHistoryPath,
      replayTempPath,
      createdAt: segmentStartMs,
      finalizedAt: now,
      durationSeconds: segmentDurationMs / 1000,
      sizeBytes: effectiveSizeBytes,
    },
  ].sort((a, b) => a.segmentIndex - b.segmentIndex);

  manifest.durationMs = manifest.segments.reduce(
    (sum, segment) => sum + Math.max(0, Number(segment.durationSeconds || 0) * 1000),
    0,
  );
  manifest.totalSizeBytes = manifest.segments.reduce(
    (sum, segment) => sum + Math.max(0, Number(segment.sizeBytes || 0)),
    0,
  );

  await saveManifest(webcamFolderName, manifest);

  console.log('[HistoryRecording]', {
    event: 'segmentSaved',
    segmentMode: true,
    finalOutputPath: historyFolder,
    finalDurationMs: manifest.segments.reduce(
      (sum, segment) => sum + Math.max(0, Number(segment.durationSeconds || 0) * 1000),
      0,
    ),
    finalSize: manifest.segments.reduce(
      (sum, segment) => sum + Math.max(0, Number(segment.sizeBytes || 0)),
      0,
    ),
  });

  console.log('[HistoryVideo] segment finalized', finalHistoryPath);
  console.log('[HistoryVideo] segment duration', options.durationSeconds ?? 'unknown');
  console.log('[VideoStorage] segment stopped', finalHistoryPath);
  console.log('[VideoStorage] segment saved', finalHistoryPath);

  console.log('[WindowsVideoStorage] fileExists after record =', fileExists);
  console.log('[HistoryRecorder]', {
    event: 'finalized',
    outputPath: finalHistoryPath,
    fileExists,
    fileSize: sizeBytes,
    savedMetadata: `${historyFolder}/${MATCH_MANIFEST_FILE_NAME}`,
  });

  await pruneReplayStorage(MAX_REPLAY_STORAGE_BYTES, [webcamFolderName]);

  return finalHistoryPath;
};

export const exportMatchToArchive = async (
  webcamFolderName: string,
  options: ExportMatchArchiveOptions = {},
) => {
  const manifest = await getManifest(webcamFolderName);
  manifest.status = 'completed';
  const endedAt = Number(options.endedAt || Date.now());
  manifest.endTime = new Date(endedAt).toISOString();
  manifest.exportedAt = Date.now();
  manifest.durationMs = Number.isFinite(Number(options.durationMs))
    ? Number(options.durationMs)
    : manifest.segments.reduce(
        (sum, segment) => sum + Math.max(0, Number(segment.durationSeconds || 0) * 1000),
        0,
      );
  manifest.totalSizeBytes = manifest.segments.reduce(
    (sum, segment) => sum + Math.max(0, Number(segment.sizeBytes || 0)),
    0,
  );
  manifest.finalVideoPath = manifest.segments[manifest.segments.length - 1]?.path || manifest.finalVideoPath;
  if (Array.isArray(options.finalScore)) {
    manifest.finalScore = options.finalScore.map(score => Number(score || 0));
  }
  if (typeof options.winnerName === 'string') {
    manifest.winnerName = options.winnerName;
  }
  if (Array.isArray(options.finalPlayers)) {
    manifest.finalPlayers = JSON.parse(JSON.stringify(options.finalPlayers));
  }
  if (Number.isFinite(Number(options.finalTurn))) {
    manifest.finalTurn = Number(options.finalTurn);
  }
  if (typeof options.overlayTimelinePath === 'string') {
    manifest.overlayTimelinePath = options.overlayTimelinePath;
  }
  manifest.finalResultSavedAt = Date.now();

  await saveManifest(webcamFolderName, manifest);
  const archiveFolder = await ensureArchiveFolder(webcamFolderName);
  console.log('[HistoryRecording]', {
    event: 'stopFullMatchRecording',
    segmentMode: true,
    finalOutputPath: archiveFolder,
    finalDurationMs: manifest.segments.reduce(
      (sum, segment) => sum + Math.max(0, Number(segment.durationSeconds || 0) * 1000),
      0,
    ),
    finalSize: manifest.segments.reduce(
      (sum, segment) => sum + Math.max(0, Number(segment.sizeBytes || 0)),
      0,
    ),
  });
  return archiveFolder;
};

export const pruneReplayStorage = async (
  maxBytes = MAX_REPLAY_STORAGE_BYTES,
  protectedFolderNames: string[] = [],
) => {
  const baseDir = await ensureReplayRoot();
  const historyRoot = await getHistoryRoot();
  const replayRoot = await getReplayTempRoot();
  const protectedNames = new Set(
    protectedFolderNames.flatMap(name => [name, folderNameFromWebcam(name)]),
  );

  console.log('[VideoStorage] cleanup started');
  let total = await getDirectorySize(baseDir);
  const deleted: string[] = [];

  console.log('[VideoStorage] total size before cleanup', total);
  console.log('[VideoStorage] current total size', total);
  console.log('[VideoStorage] replay temp storage limit', MAX_REPLAY_STORAGE_BYTES);
  console.log('[VideoStorage] max quota', maxBytes);
  console.log('[VideoStorage] cleanup threshold', VIDEO_STORAGE_CLEANUP_THRESHOLD_BYTES);

  if (total <= VIDEO_STORAGE_CLEANUP_THRESHOLD_BYTES) {
    console.log('[VideoStorage] cleanup completed');
    console.log('[VideoStorage] total size after cleanup', total);
    return {totalBytes: total, deleted};
  }

  console.log('[VideoStorage] quota exceeded', {total, maxBytes});

  const replayFolders = await readChildDirectories(replayRoot);
  for (const folder of replayFolders) {
    if (total <= VIDEO_STORAGE_CLEANUP_THRESHOLD_BYTES) {
      break;
    }

    if (protectedNames.has(folder.name)) {
      console.log('[VideoStorage] skip deleting active match/replay file', folder.path);
      continue;
    }

    try {
      const size = await getDirectorySize(folder.path);
      await RNFS.unlink(folder.path);
      total -= size;
      deleted.push(`replay-temp:${folder.name}`);
      console.log('[VideoStorage] deleted old file/folder', folder.path);
      console.log('[VideoStorage] deleted oldest', folder.path);
    } catch (error) {
      console.log('[VideoStorage] delete replay temp failed', {path: folder.path, error});
    }
  }

  const historySize = await getDirectorySize(historyRoot);
  if (historySize > 0) {
    console.log('[VideoStorage] history auto-delete skipped', {
      historyRoot,
      historySize,
      reason: 'History videos are long-term files and are deleted only by user action',
    });
  }

  console.log('[VideoStorage] cleanup completed');
  console.log('[VideoStorage] total size after cleanup', total);

  return {totalBytes: total, deleted};
};

export const listHistoryMatches = async (): Promise<HistoryMatchEntry[]> => {
  const historyRoot = await getHistoryRoot();
  const folders = await readChildDirectories(historyRoot);
  const entries: HistoryMatchEntry[] = [];

  let metadataCount = 0;
  let scannedFileCount = 0;

  for (const folder of folders) {
    const metadataPath = `${folder.path}/${MATCH_MANIFEST_FILE_NAME}`;
    let manifest: ReplayMatchManifest | undefined;

    if (await RNFS.exists(metadataPath)) {
      try {
        const raw = await RNFS.readFile(metadataPath);
        const parsed = JSON.parse(raw);
        const manifestWebcamFolderName = String(parsed?.webcamFolderName || folder.name);
        manifest = normalizeManifest(manifestWebcamFolderName, parsed);
        metadataCount += 1;
      } catch (error) {
        console.log('[HistoryScreen] metadata read failed', {metadataPath, error});
      }
    }

    const files = await readVideoFiles(folder.path, true);
    scannedFileCount += files.length;

    if (!files.length) {
      console.log('[HistoryScreen] skip empty folder', {
        path: folder.path,
        exists: await RNFS.exists(folder.path),
        size: 0,
      });
      continue;
    }

    const totalSizeBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const updatedAt = Math.max(...files.map(file => safeMtime(file)), safeMtime(folder), 0);

    for (const file of files) {
      console.log('[HistoryScreen]', {
        itemPath: file.path,
        exists: true,
        size: Number(file.size || 0),
      });
    }

    entries.push({
      webcamFolderName: manifest?.webcamFolderName || folder.name,
      folderName: folder.name,
      folderPath: folder.path,
      manifest,
      files,
      createdAt: manifest?.createdAt || safeMtime(folder) || Date.now(),
      updatedAt: manifest?.updatedAt || updatedAt || Date.now(),
      totalSizeBytes,
    });
  }

  const finalList = entries.sort((a, b) => b.updatedAt - a.updatedAt);

  console.log('[HistoryScreen]', {
    metadataCount,
    scannedFileCount,
    finalListCount: finalList.length,
    historyDir: historyRoot,
  });

  return finalList;
};

export const deleteReplayFolder = async (
  webcamFolderName?: string,
  options?: {includeArchive?: boolean},
) => {
  if (!webcamFolderName) {
    return;
  }

  const replayPath = await getReplayFolderPath(webcamFolderName);

  try {
    if (await RNFS.exists(replayPath)) {
      await RNFS.unlink(replayPath);
      console.log('[Replay] cleanup temp success', replayPath);
      console.log('[ReplayRecorder]', {
        event: 'cleanup',
        outputPath: replayPath,
        reason: 'deleted replay temp only',
      });
    }
  } catch (error) {
    console.log('[Replay] cleanup temp fail', {path: replayPath, error});
  }

  if (options?.includeArchive !== true) {
    console.log('[HistoryRecorder]', {
      event: 'preserve-history',
      outputPath: await getHistoryFolderPath(webcamFolderName),
      reason: 'includeArchive is false',
    });
  }

  if (options?.includeArchive === true) {
    const archivePath = await getHistoryFolderPath(webcamFolderName);
    try {
      if (await RNFS.exists(archivePath)) {
        await RNFS.unlink(archivePath);
        manifests.delete(webcamFolderName);
        console.log('[VideoStorage] deleted old match folder/file', archivePath);
      }
    } catch (error) {
      console.log('[VideoStorage] delete archive failed', {path: archivePath, error});
    }
  }
};

export const normalizeWindowsVideoUri = (inputPath?: string | null) => {
  const raw = String(inputPath || '').trim();

  if (!raw) {
    return '';
  }

  if (/^[a-z]+:\/\//i.test(raw) && !raw.toLowerCase().startsWith('file://')) {
    return raw;
  }

  if (raw.toLowerCase().startsWith('file://')) {
    return raw.replace(/\\/g, '/');
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
