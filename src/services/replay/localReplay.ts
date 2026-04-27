import RNFS from 'react-native-fs';

export const RECORDING_SEGMENT_DURATION_MS = 2 * 60 * 1000;
export const MAX_REPLAY_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;
export const REPLAY_WINDOW_SEGMENTS = 3;

const INTERNAL_MEDIA_ROOT = `${RNFS.ExternalDirectoryPath || RNFS.DocumentDirectoryPath}/Aplus Billiards`;
const PUBLIC_MEDIA_ROOT = `${RNFS.DownloadDirectoryPath}/Aplus Billiards`;
export const REPLAY_ROOT = `${INTERNAL_MEDIA_ROOT}/ReplayBuffer`;
export const ARCHIVE_ROOT = `${PUBLIC_MEDIA_ROOT}/Saved Videos`;
const LEGACY_REPLAY_ROOT = RNFS.DownloadDirectoryPath;
const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.ts'];
const MATCH_MANIFEST_FILE_NAME = 'match.json';
const MIN_VALID_VIDEO_BYTES = 1 * 1024 * 1024;
const FILE_SETTLE_MS = 1500;
const PRUNE_MIN_INTERVAL_MS = 15 * 60 * 1000;
const SESSION_STALE_MS = 24 * 60 * 60 * 1000;

let lastPruneRunAt = 0;

export type ReplaySegmentEntry = {
  segmentIndex: number;
  fileName: string;
  createdAt: number;
  sizeBytes: number;
};

export type ReplayMatchManifest = {
  version: number;
  webcamFolderName: string;
  matchSessionId?: string;
  keepFullMatch: boolean;
  createdAt: number;
  updatedAt: number;
  exportedAt?: number;
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

export const buildReplayFolderPath = (webcamFolderName: string) => `${REPLAY_ROOT}/${webcamFolderName}`;
export const buildArchiveFolderPath = (webcamFolderName: string) => `${ARCHIVE_ROOT}/${webcamFolderName}`;
export const buildLegacyReplayFolderPath = (webcamFolderName: string) => `${LEGACY_REPLAY_ROOT}/${webcamFolderName}`;
const buildManifestPath = (folderPath: string) => `${folderPath}/${MATCH_MANIFEST_FILE_NAME}`;

const basename = (filePath: string) => filePath.split('/').pop() || `segment_${Date.now()}.mp4`;

const isVideoFile = (name: string) => {
  const lower = name.toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
};

const safeMtime = (item: RNFS.ReadDirItem) => (item.mtime ? new Date(item.mtime).getTime() : 0);

const hasValidVideoShape = (item: RNFS.ReadDirItem) => {
  if (!item.isFile() || !isVideoFile(item.name)) {
    return false;
  }

  const size = Number(item.size || 0);
  return size >= MIN_VALID_VIDEO_BYTES;
};

const isSettlingVideo = (item: RNFS.ReadDirItem) => {
  const mtime = safeMtime(item);
  return mtime > 0 && Date.now() - mtime < FILE_SETTLE_MS;
};

const sortByAge = (a: RNFS.ReadDirItem, b: RNFS.ReadDirItem) => {
  const mtimeDiff = safeMtime(a) - safeMtime(b);
  if (mtimeDiff !== 0) {
    return mtimeDiff;
  }
  return a.name.localeCompare(b.name, undefined, {numeric: true});
};

const readVideoFiles = async (folderPath: string) => {
  const items = await RNFS.readDir(folderPath);
  return items.filter(hasValidVideoShape).sort(sortByAge);
};

const ensureDir = async (folderPath: string) => {
  if (!(await RNFS.exists(folderPath))) {
    await RNFS.mkdir(folderPath);
  }
  return folderPath;
};

const normalizeManifest = (
  webcamFolderName: string,
  current?: Partial<ReplayMatchManifest> | null,
): ReplayMatchManifest => {
  const createdAt = Number(current?.createdAt || Date.now());
  const segments = Array.isArray(current?.segments)
    ? current!.segments
        .map(segment => ({
          segmentIndex: Number(segment.segmentIndex || 0),
          fileName: String(segment.fileName || ''),
          createdAt: Number(segment.createdAt || createdAt),
          sizeBytes: Number(segment.sizeBytes || 0),
        }))
        .filter(segment => segment.fileName.length > 0)
        .sort((a, b) => a.segmentIndex - b.segmentIndex)
    : [];

  return {
    version: 1,
    webcamFolderName,
    matchSessionId: current?.matchSessionId,
    keepFullMatch: Boolean(current?.keepFullMatch),
    createdAt,
    updatedAt: Date.now(),
    exportedAt: current?.exportedAt,
    segments,
  };
};

const readManifestFromFolder = async (folderPath: string, webcamFolderName: string) => {
  const manifestPath = buildManifestPath(folderPath);
  if (!(await RNFS.exists(manifestPath))) {
    return normalizeManifest(webcamFolderName, null);
  }

  try {
    const raw = await RNFS.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeManifest(webcamFolderName, parsed);
  } catch (error) {
    console.log('[Replay] failed to read match manifest:', error);
    return normalizeManifest(webcamFolderName, null);
  }
};

const writeManifestToFolder = async (folderPath: string, manifest: ReplayMatchManifest) => {
  const normalized = normalizeManifest(manifest.webcamFolderName, manifest);
  await RNFS.writeFile(
    buildManifestPath(folderPath),
    JSON.stringify(normalized, null, 2),
    'utf8',
  );
  return normalized;
};

export const extractReplaySegmentIndex = (filePathOrName?: string | null) => {
  const target = String(filePathOrName || '');
  const match = target.match(/part_(\d+)/i);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, parsed - 1);
};

const buildSegmentFileName = (segmentIndex: number, segmentPath: string) => {
  const ext = basename(segmentPath).split('.').pop()?.toLowerCase();
  const resolvedExt = ext && VIDEO_EXTENSIONS.includes(`.${ext}`) ? ext : 'mp4';
  return `part_${String(segmentIndex + 1).padStart(4, '0')}.${resolvedExt}`;
};

const cleanupFolderBrokenFiles = async (folderPath?: string) => {
  if (!folderPath || !(await RNFS.exists(folderPath))) {
    return;
  }

  const items = await RNFS.readDir(folderPath);

  for (const item of items) {
    const lowerName = item.name.toLowerCase();

    const isBrokenVideo =
      item.isFile() &&
      isVideoFile(item.name) &&
      !isSettlingVideo(item) &&
      !hasValidVideoShape(item);

    const isTmpLike =
      item.isFile() &&
      (lowerName.endsWith('.tmp') ||
        lowerName.endsWith('.part') ||
        lowerName.includes('temp'));

    if (!isBrokenVideo && !isTmpLike) {
      continue;
    }

    try {
      await RNFS.unlink(item.path);
      console.log('[Replay] removed broken file:', item.path);
    } catch (error) {
      console.log('[Replay] failed to remove broken file:', item.path, error);
    }
  }
};

export const ensureReplayRoot = async () => {
  await ensureDir(INTERNAL_MEDIA_ROOT);
  await ensureDir(PUBLIC_MEDIA_ROOT);
  await ensureDir(REPLAY_ROOT);
  await ensureDir(ARCHIVE_ROOT);
};

export const ensureReplayFolder = async (webcamFolderName: string) => {
  await ensureReplayRoot();
  return ensureDir(buildReplayFolderPath(webcamFolderName));
};

export const ensureArchiveFolder = async (webcamFolderName: string) => {
  await ensureReplayRoot();
  return ensureDir(buildArchiveFolderPath(webcamFolderName));
};

export const resolveReplayFolder = async (webcamFolderName: string) => {
  const currentPath = buildReplayFolderPath(webcamFolderName);
  if (await RNFS.exists(currentPath)) {
    return currentPath;
  }

  const archivePath = buildArchiveFolderPath(webcamFolderName);
  if (await RNFS.exists(archivePath)) {
    return archivePath;
  }

  const legacyPath = buildLegacyReplayFolderPath(webcamFolderName);
  if (await RNFS.exists(legacyPath)) {
    return legacyPath;
  }

  return undefined;
};

export const readReplayMatchManifest = async (webcamFolderName: string) => {
  const folderPath =
    (await resolveReplayFolder(webcamFolderName)) ||
    (await ensureReplayFolder(webcamFolderName));

  return readManifestFromFolder(folderPath, webcamFolderName);
};

export const getNextReplaySegmentIndex = async (webcamFolderName: string) => {
  const manifest = await readReplayMatchManifest(webcamFolderName);
  const lastSegment = manifest.segments[manifest.segments.length - 1];
  return lastSegment ? lastSegment.segmentIndex + 1 : 0;
};

export const cleanupBrokenReplayFiles = async (webcamFolderName: string) => {
  const replayFolderPath = buildReplayFolderPath(webcamFolderName);
  const archiveFolderPath = buildArchiveFolderPath(webcamFolderName);

  await cleanupFolderBrokenFiles(replayFolderPath);
  await cleanupFolderBrokenFiles(archiveFolderPath);
};

const pruneReplayWindowForFolder = async (
  webcamFolderName: string,
  keepFullMatch: boolean,
) => {
  if (keepFullMatch) {
    return;
  }

  const folderPath = buildReplayFolderPath(webcamFolderName);
  if (!(await RNFS.exists(folderPath))) {
    return;
  }

  const files = await readVideoFiles(folderPath);
  const overflow = files.length - REPLAY_WINDOW_SEGMENTS;
  if (overflow <= 0) {
    return;
  }

  const staleFiles = files.slice(0, overflow);
  const staleNames = new Set(staleFiles.map(file => file.name));

  for (const file of staleFiles) {
    try {
      await RNFS.unlink(file.path);
      console.log('[Replay] dropped oldest replay clip:', file.path);
    } catch (error) {
      console.log('[Replay] failed to drop oldest replay clip:', file.path, error);
    }
  }

  const manifest = await readManifestFromFolder(folderPath, webcamFolderName);
  manifest.segments = manifest.segments.filter(
    segment => !staleNames.has(segment.fileName),
  );
  await writeManifestToFolder(folderPath, manifest);
};

const listVideoFilesFromFolder = async (folderPath?: string) => {
  if (!folderPath || !(await RNFS.exists(folderPath))) {
    return [] as RNFS.ReadDirItem[];
  }

  const files = await readVideoFiles(folderPath);
  const settled = files.filter(item => !isSettlingVideo(item));
  return settled.length > 0 ? settled : files;
};

export const listReplayFiles = async (webcamFolderName: string) => {
  const folderPath = buildReplayFolderPath(webcamFolderName);
  const files = await listVideoFilesFromFolder(folderPath);
  return files.slice(-REPLAY_WINDOW_SEGMENTS);
};

export const listArchiveFiles = async (webcamFolderName: string) => {
  const folderPath = buildArchiveFolderPath(webcamFolderName);
  return listVideoFilesFromFolder(folderPath);
};

export const listPlayableFiles = async (
  webcamFolderName: string,
  preferArchive = false,
) => {
  if (preferArchive) {
    const archiveFiles = await listArchiveFiles(webcamFolderName);
    if (archiveFiles.length > 0) {
      return archiveFiles;
    }
  }

  return listReplayFiles(webcamFolderName);
};

export const waitForReplayFiles = async (
  webcamFolderName: string,
  minCount = 1,
  timeoutMs = 8000,
) => {
  const startedAt = Date.now();
  let files = await listReplayFiles(webcamFolderName);

  while (files.length < minCount && Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 400));
    files = await listReplayFiles(webcamFolderName);
  }

  return files;
};

export const registerReplaySegment = async (
  webcamFolderName: string,
  segmentPath: string,
  options: RegisterReplaySegmentOptions = {},
) => {
  const replayFolderPath = await ensureReplayFolder(webcamFolderName);

  try {
    const stat = await RNFS.stat(segmentPath);
    const size = Number(stat.size || 0);

    if (size < MIN_VALID_VIDEO_BYTES) {
      console.log('[Replay] reject tiny segment:', segmentPath, size);
      try {
        await RNFS.unlink(segmentPath);
      } catch {}
      return undefined;
    }

    const existingManifest = await readManifestFromFolder(
      replayFolderPath,
      webcamFolderName,
    );
    const nextSegmentIndex = Number.isFinite(options.segmentIndex)
      ? Number(options.segmentIndex)
      : existingManifest.segments.length > 0
      ? existingManifest.segments[existingManifest.segments.length - 1].segmentIndex + 1
      : 0;

    const nextFileName = buildSegmentFileName(nextSegmentIndex, segmentPath);
    const replayPath = `${replayFolderPath}/${nextFileName}`;

    if (segmentPath !== replayPath) {
      try {
        await RNFS.moveFile(segmentPath, replayPath);
        segmentPath = replayPath;
      } catch (moveError) {
        console.log('[Replay] move into replay folder failed, trying copy:', moveError);
        await RNFS.copyFile(segmentPath, replayPath);
        try {
          await RNFS.unlink(segmentPath);
        } catch {}
        segmentPath = replayPath;
      }
    }

    const nextManifest = normalizeManifest(webcamFolderName, {
      ...existingManifest,
      matchSessionId: options.matchSessionId || existingManifest.matchSessionId,
      keepFullMatch: Boolean(options.keepFullMatch),
      segments: [
        ...existingManifest.segments.filter(
          entry => entry.segmentIndex !== nextSegmentIndex && entry.fileName !== nextFileName,
        ),
        {
          segmentIndex: nextSegmentIndex,
          fileName: nextFileName,
          createdAt: Date.now(),
          sizeBytes: size,
        },
      ].sort((a, b) => a.segmentIndex - b.segmentIndex),
    });

    await writeManifestToFolder(replayFolderPath, nextManifest);
    await pruneReplayWindowForFolder(webcamFolderName, nextManifest.keepFullMatch);
  } catch (error) {
    console.log('[Replay] stat/register failed:', error);
  }

  return segmentPath;
};

export const exportMatchToArchive = async (webcamFolderName: string) => {
  const replayFolderPath = buildReplayFolderPath(webcamFolderName);
  if (!(await RNFS.exists(replayFolderPath))) {
    return undefined;
  }

  const archiveFolderPath = await ensureArchiveFolder(webcamFolderName);
  const files = await listVideoFilesFromFolder(replayFolderPath);
  if (!files.length) {
    return undefined;
  }

  for (const file of files) {
    const targetPath = `${archiveFolderPath}/${file.name}`;
    if (await RNFS.exists(targetPath)) {
      continue;
    }

    await RNFS.copyFile(file.path, targetPath);
  }

  const manifest = await readManifestFromFolder(replayFolderPath, webcamFolderName);
  const exportedManifest = await writeManifestToFolder(archiveFolderPath, {
    ...manifest,
    exportedAt: Date.now(),
    keepFullMatch: true,
  });

  await writeManifestToFolder(replayFolderPath, exportedManifest);
  return archiveFolderPath;
};

const getDirectorySize = async (directoryPath: string): Promise<number> => {
  if (!(await RNFS.exists(directoryPath))) {
    return 0;
  }

  const items = await RNFS.readDir(directoryPath);
  let total = 0;

  for (const item of items) {
    if (item.isFile()) {
      total += Number(item.size || 0);
      continue;
    }

    if (item.isDirectory()) {
      total += await getDirectorySize(item.path);
    }
  }

  return total;
};

const listChildDirectories = async (rootPath: string) => {
  if (!(await RNFS.exists(rootPath))) {
    return [] as RNFS.ReadDirItem[];
  }

  const items = await RNFS.readDir(rootPath);
  return items.filter(item => item.isDirectory()).sort(sortByAge);
};

const getSessionLastActivity = async (dir: RNFS.ReadDirItem) => {
  try {
    const files = await readVideoFiles(dir.path);
    const latestVideo = files[files.length - 1];
    if (latestVideo) {
      return safeMtime(latestVideo);
    }
  } catch {}
  return safeMtime(dir);
};

export const pruneReplayStorage = async (
  maxBytes = MAX_REPLAY_STORAGE_BYTES,
  protectedFolderNames: string[] = [],
) => {
  await ensureReplayRoot();

  const now = Date.now();
  if (now - lastPruneRunAt < PRUNE_MIN_INTERVAL_MS) {
    return {
      throttled: true,
      totalBytes: await getDirectorySize(REPLAY_ROOT),
      deleted: [] as string[],
    };
  }
  lastPruneRunAt = now;

  let total = await getDirectorySize(REPLAY_ROOT);
  const deleted: string[] = [];
  const replayDirs = await listChildDirectories(REPLAY_ROOT);

  for (const dir of replayDirs) {
    const lastActivity = await getSessionLastActivity(dir);
    const isStale = now - lastActivity > SESSION_STALE_MS;
    if (total <= maxBytes && !isStale) {
      continue;
    }
    if (protectedFolderNames.includes(dir.name)) {
      continue;
    }

    try {
      const dirSize = await getDirectorySize(dir.path);
      await RNFS.unlink(dir.path);
      total -= dirSize;
      deleted.push(`replay:${dir.name}`);
    } catch (error) {
      console.log('[Replay] failed to prune replay folder:', dir.path, error);
    }
  }

  return {totalBytes: total, deleted};
};

export const deleteReplayFolder = async (
  webcamFolderName?: string,
  options?: {includeArchive?: boolean},
) => {
  if (!webcamFolderName) {
    return;
  }

  const replayPath = buildReplayFolderPath(webcamFolderName);
  const archivePath = buildArchiveFolderPath(webcamFolderName);
  const legacyPath = buildLegacyReplayFolderPath(webcamFolderName);

  if (await RNFS.exists(replayPath)) {
    await RNFS.unlink(replayPath);
  }

  if (options?.includeArchive !== false && (await RNFS.exists(archivePath))) {
    await RNFS.unlink(archivePath);
  }

  if (await RNFS.exists(legacyPath)) {
    await RNFS.unlink(legacyPath);
  }
};
