import RNFS from 'react-native-fs';

export const RECORDING_SEGMENT_DURATION_MS = 5 * 60 * 1000;
export const MAX_REPLAY_STORAGE_BYTES = 15 * 1024 * 1024 * 1024;
export const VIDEO_STORAGE_CLEANUP_THRESHOLD_BYTES = 14 * 1024 * 1024 * 1024;
export const REPLAY_WINDOW_SEGMENTS = 2;
export const REPLAY_WINDOW_SECONDS = 2 * 60;

export const WINDOWS_VIDEO_PRIMARY_BASE_DIR = 'C:/video/aplus score';
export const HISTORY_FOLDER_NAME = 'history';
export const REPLAY_TEMP_FOLDER_NAME = 'replay-temp';
export const REPLAY_TEMP_CURRENT_FOLDER_NAME = 'current';

export const REPLAY_ROOT = `${WINDOWS_VIDEO_PRIMARY_BASE_DIR}/${REPLAY_TEMP_FOLDER_NAME}/${REPLAY_TEMP_CURRENT_FOLDER_NAME}`;
export const ARCHIVE_ROOT = `${WINDOWS_VIDEO_PRIMARY_BASE_DIR}/${HISTORY_FOLDER_NAME}`;

const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.ts'];
const MATCH_MANIFEST_FILE_NAME = 'metadata.json';

type ReadDirItem = {
  ctime?: Date;
  mtime?: Date;
  name: string;
  path: string;
  size: number;
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
  segments: ReplaySegmentEntry[];
};

export type RegisterReplaySegmentOptions = {
  keepFullMatch?: boolean;
  matchSessionId?: string;
  segmentIndex?: number;
  mode?: string;
  playerNames?: string[];
  segmentStartedAt?: number;
  durationSeconds?: number;
};

export type BuildWindowsRecordingOutputPathOptions = {
  webcamFolderName: string;
  segmentIndex?: number;
  matchSessionId?: string;
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

const isVideoFile = (name?: string | null) => {
  const lower = String(name || '').toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
};

const safeMtime = (item: ReadDirItem) => {
  const raw = item.mtime ? new Date(item.mtime).getTime() : 0;
  return Number.isFinite(raw) ? raw : 0;
};

const ensureDir = async (folderPath: string) => {
  const normalized = normalizePath(folderPath);
  if (!(await RNFS.exists(normalized))) {
    await RNFS.mkdir(normalized);
  }
  return normalized;
};

const readFallbackBaseDir = async () => {
  const helper = RNFS as any;
  if (typeof helper.getFallbackBaseDir === 'function') {
    return normalizePath(await helper.getFallbackBaseDir());
  }

  return 'C:/Users/Public/Videos/aplus score';
};

const ensureBaseAt = async (baseDir: string) => {
  const normalized = normalizePath(baseDir);
  await ensureDir(normalized);
  await ensureDir(`${normalized}/${HISTORY_FOLDER_NAME}`);
  await ensureDir(`${normalized}/${REPLAY_TEMP_FOLDER_NAME}`);
  await ensureDir(`${normalized}/${REPLAY_TEMP_FOLDER_NAME}/${REPLAY_TEMP_CURRENT_FOLDER_NAME}`);
  return normalized;
};

export const ensureReplayRoot = async () => {
  if (activeBaseDir) {
    return activeBaseDir;
  }

  console.log('[VideoStorage] baseDir', WINDOWS_VIDEO_PRIMARY_BASE_DIR);
  console.log('[WindowsVideoStorage] baseDir =', WINDOWS_VIDEO_PRIMARY_BASE_DIR);

  try {
    activeBaseDir = await ensureBaseAt(WINDOWS_VIDEO_PRIMARY_BASE_DIR);
    console.log('[WindowsVideoStorage] ensureDir ok =', true);
  } catch (error) {
    console.log('[WindowsVideoStorage] ensureDir ok =', false);
    console.log('[WindowsVideoStorage] ensureDir error =', error);

    const fallbackDir = await readFallbackBaseDir();
    console.log('[WindowsVideoStorage] fallbackDir =', fallbackDir);
    console.log('[VideoStorage] baseDir', fallbackDir);

    activeBaseDir = await ensureBaseAt(fallbackDir);
  }

  console.log('[VideoStorage] replayTempDir', `${activeBaseDir}/${REPLAY_TEMP_FOLDER_NAME}/${REPLAY_TEMP_CURRENT_FOLDER_NAME}`);
  console.log('[VideoStorage] historyDir', `${activeBaseDir}/${HISTORY_FOLDER_NAME}`);

  return activeBaseDir;
};

const getReplayTempRoot = async () =>
  `${await ensureReplayRoot()}/${REPLAY_TEMP_FOLDER_NAME}/${REPLAY_TEMP_CURRENT_FOLDER_NAME}`;

const getHistoryRoot = async () => `${await ensureReplayRoot()}/${HISTORY_FOLDER_NAME}`;

export const getWindowsVideoBaseDir = ensureReplayRoot;

export const buildReplayFolderPath = (webcamFolderName: string) => {
  return `${REPLAY_ROOT}/${folderNameFromWebcam(webcamFolderName)}`;
};

export const buildArchiveFolderPath = (webcamFolderName: string) => {
  return `${ARCHIVE_ROOT}/${folderNameFromWebcam(webcamFolderName)}`;
};

export const buildLegacyReplayFolderPath = buildReplayFolderPath;

const getReplayFolderPath = async (webcamFolderName: string) =>
  `${await getReplayTempRoot()}/${folderNameFromWebcam(webcamFolderName)}`;

const getHistoryFolderPath = async (webcamFolderName: string) =>
  `${await getHistoryRoot()}/${folderNameFromWebcam(webcamFolderName)}`;

const getMetadataPath = async (webcamFolderName: string) =>
  `${await getHistoryFolderPath(webcamFolderName)}/${MATCH_MANIFEST_FILE_NAME}`;

const toSegmentFileName = (segmentIndex: number) =>
  `segment_${String(Math.max(0, segmentIndex) + 1).padStart(4, '0')}.mp4`;

const toReplayTempFileName = (segmentIndex: number) =>
  `replay_segment_${String(Math.max(0, segmentIndex) + 1).padStart(3, '0')}.mp4`;

const readVideoFiles = async (folderPath: string) => {
  try {
    const normalized = normalizePath(folderPath);
    if (!(await RNFS.exists(normalized))) {
      return [] as ReadDirItem[];
    }

    const items = (await RNFS.readDir(normalized)) as ReadDirItem[];
    return items
      .filter(item => item.isFile() && isVideoFile(item.name) && Number(item.size || 0) > 0)
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
    segmentDurationMinutes: 5,
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
    segmentDurationMinutes: 5,
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
  console.log('[HistoryVideo] segment started', {
    webcamFolderName: options.webcamFolderName,
    segmentIndex,
    outputFile,
  });

  return outputFile;
};

export const extractReplaySegmentIndex = (filePathOrName?: string | null) => {
  const target = String(filePathOrName || '');
  const match = target.match(/(?:segment_|replay_segment_|part_|webcam_)(\d+)/i);

  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number(match[1]);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  // Old webcam_00 files were zero-based. New segment_0001 files are one-based.
  return /(?:segment_|replay_segment_)/i.test(target)
    ? Math.max(0, parsed - 1)
    : Math.max(0, parsed);
};

const copySegmentToReplayTemp = async (
  webcamFolderName: string,
  historySegmentPath: string,
  segmentIndex: number,
) => {
  const replayFolder = await ensureReplayFolder(webcamFolderName);
  const replayPath = `${replayFolder}/${toReplayTempFileName(segmentIndex)}`;

  try {
    await RNFS.copyFile(historySegmentPath, replayPath);
    console.log('[VideoStorage] replay buffer ready', replayPath);
  } catch (error) {
    console.log('[Replay] replay temp copy failed', {
      inputPath: historySegmentPath,
      replayPath,
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
    const files = await readVideoFiles(folder.path);
    for (const file of files) {
      if (Number(file.size || 0) > 0) {
        continue;
      }

      try {
        await RNFS.unlink(file.path);
        console.log('[Replay] cleanup temp success', file.path);
      } catch (error) {
        console.log('[Replay] cleanup temp fail', {path: file.path, error});
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
  const files = (await readVideoFiles(folderPath)).slice(-REPLAY_WINDOW_SEGMENTS);

  if (files.length) {
    console.log('[Replay] selected replay segments', files.map(file => file.path));
    console.log('[Replay] replay duration', `target=${REPLAY_WINDOW_SECONDS}s`);
    console.log('[VideoStorage] replay file selected', files[files.length - 1]?.path);
  } else {
    console.log('[VideoStorage] replay file missing', folderPath);
  }

  return files;
};

export const listArchiveFiles = async (webcamFolderName: string) => {
  const folderPath = await ensureArchiveFolder(webcamFolderName);
  return readVideoFiles(folderPath);
};

export const listPlayableFiles = async (
  webcamFolderName: string,
  preferArchive = false,
) => {
  const archive = await listArchiveFiles(webcamFolderName);
  const replay = await listReplayFiles(webcamFolderName);
  return preferArchive ? [...archive, ...replay] : [...replay, ...archive];
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
  const expectedHistoryPath = `${historyFolder}/${toSegmentFileName(segmentIndex)}`;
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
  const sizeBytes = await getFileSize(finalHistoryPath);
  const now = Date.now();

  const replayTempPath = await copySegmentToReplayTemp(
    webcamFolderName,
    finalHistoryPath,
    segmentIndex,
  );

  const manifest = await getManifest(webcamFolderName);
  manifest.matchId = options.matchSessionId || manifest.matchId || webcamFolderName;
  manifest.keepFullMatch = true;
  manifest.status = 'recording';
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
      createdAt: options.segmentStartedAt || now,
      finalizedAt: now,
      durationSeconds: options.durationSeconds,
      sizeBytes,
    },
  ].sort((a, b) => a.segmentIndex - b.segmentIndex);

  await saveManifest(webcamFolderName, manifest);

  console.log('[HistoryVideo] segment finalized', finalHistoryPath);
  console.log('[HistoryVideo] segment duration', options.durationSeconds ?? 'unknown');
  console.log('[VideoStorage] segment stopped', finalHistoryPath);
  console.log('[VideoStorage] segment saved', finalHistoryPath);

  const exists = await RNFS.exists(finalHistoryPath);
  console.log('[WindowsVideoStorage] fileExists after record =', exists);

  await pruneReplayStorage(MAX_REPLAY_STORAGE_BYTES, [webcamFolderName]);

  return finalHistoryPath;
};

export const exportMatchToArchive = async (webcamFolderName: string) => {
  const manifest = await getManifest(webcamFolderName);
  manifest.status = 'completed';
  manifest.endTime = new Date().toISOString();
  manifest.exportedAt = Date.now();

  await saveManifest(webcamFolderName, manifest);
  return ensureArchiveFolder(webcamFolderName);
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
  console.log('[VideoStorage] storage limit 15GB', MAX_REPLAY_STORAGE_BYTES);
  console.log('[VideoStorage] max quota 15GB', maxBytes);
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

  const historyFolders = await readChildDirectories(historyRoot);
  for (const folder of historyFolders) {
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
      deleted.push(`history:${folder.name}`);
      console.log('[VideoStorage] deleted old match folder/file', folder.path);
      console.log('[VideoStorage] deleted old file/folder', folder.path);
      console.log('[VideoStorage] deleted oldest', folder.path);
    } catch (error) {
      console.log('[VideoStorage] delete history failed', {path: folder.path, error});
    }
  }

  console.log('[VideoStorage] cleanup completed');
  console.log('[VideoStorage] total size after cleanup', total);

  return {totalBytes: total, deleted};
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
    }
  } catch (error) {
    console.log('[Replay] cleanup temp fail', {path: replayPath, error});
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
