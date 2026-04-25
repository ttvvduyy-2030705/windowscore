import RNFS from 'react-native-fs';

export const RECORDING_SEGMENT_DURATION_MS = 2 * 60 * 1000;
export const MAX_REPLAY_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;
export const REPLAY_WINDOW_SEGMENTS = 3;

export const REPLAY_ROOT = 'C:/AplusScoreWindows/ReplayBuffer';
export const ARCHIVE_ROOT = 'C:/AplusScoreWindows/SavedVideos';

const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.ts'];
const MATCH_MANIFEST_FILE_NAME = 'match.json';

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
};

const manifests = new Map<string, ReplayMatchManifest>();

const createManifest = (webcamFolderName: string): ReplayMatchManifest => ({
  version: 1,
  webcamFolderName,
  keepFullMatch: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  segments: [],
});

const getManifest = (webcamFolderName: string) => {
  if (!manifests.has(webcamFolderName)) {
    manifests.set(webcamFolderName, createManifest(webcamFolderName));
  }

  return manifests.get(webcamFolderName)!;
};

const basename = (filePath?: string | null) => {
  const target = String(filePath || '');
  return target.split(/[\\/]/).filter(Boolean).pop() || `segment_${Date.now()}.mp4`;
};

const isVideoFile = (name?: string | null) => {
  const lower = String(name || '').toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
};

const safeMtime = (item: RNFS.ReadDirItem) => {
  const raw = item.mtime ? new Date(item.mtime).getTime() : 0;
  return Number.isFinite(raw) ? raw : 0;
};

const ensureDir = async (folderPath: string) => {
  if (!(await RNFS.exists(folderPath))) {
    await RNFS.mkdir(folderPath);
  }
  return folderPath;
};

const readVideoFiles = async (folderPath: string) => {
  try {
    if (!(await RNFS.exists(folderPath))) {
      return [] as RNFS.ReadDirItem[];
    }

    const items = await RNFS.readDir(folderPath);
    return items
      .filter(item => item.isFile() && isVideoFile(item.name) && Number(item.size || 0) > 0)
      .sort((a, b) => safeMtime(a) - safeMtime(b));
  } catch (error) {
    console.log('[Replay] video discovery error:', {folderPath, error});
    return [] as RNFS.ReadDirItem[];
  }
};

export const buildReplayFolderPath = (webcamFolderName: string) => {
  return `${REPLAY_ROOT}/${webcamFolderName}`;
};

export const buildArchiveFolderPath = (webcamFolderName: string) => {
  return `${ARCHIVE_ROOT}/${webcamFolderName}`;
};

export const buildLegacyReplayFolderPath = buildReplayFolderPath;

export const extractReplaySegmentIndex = (filePathOrName?: string | null) => {
  const target = String(filePathOrName || '');
  const match = target.match(/(?:part_|webcam_)(\d+)/i);

  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number(match[1]);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(0, parsed - 1);
};

export const ensureReplayRoot = async () => {
  await ensureDir(REPLAY_ROOT);
  await ensureDir(ARCHIVE_ROOT);
  return REPLAY_ROOT;
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
  return ensureReplayFolder(webcamFolderName);
};

export const readReplayMatchManifest = async (webcamFolderName: string) => {
  return getManifest(webcamFolderName);
};

export const getNextReplaySegmentIndex = async (webcamFolderName: string) => {
  const manifest = getManifest(webcamFolderName);
  const lastSegment = manifest.segments[manifest.segments.length - 1];

  return lastSegment ? lastSegment.segmentIndex + 1 : 0;
};

export const cleanupBrokenReplayFiles = async (_webcamFolderName?: string) => {
  return undefined;
};

export const listReplayFiles = async (webcamFolderName: string) => {
  const folderPath = buildReplayFolderPath(webcamFolderName);
  const files = await readVideoFiles(folderPath);

  if (files.length) {
    console.log('[Replay] video discovered', {
      webcamFolderName,
      folderPath,
      count: files.length,
      latest: files[files.length - 1]?.path,
    });
  }

  return files;
};

export const listArchiveFiles = async (webcamFolderName: string) => {
  return readVideoFiles(buildArchiveFolderPath(webcamFolderName));
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
  await ensureReplayFolder(webcamFolderName);

  const manifest = getManifest(webcamFolderName);

  const segmentIndex = Number.isFinite(options.segmentIndex)
    ? Number(options.segmentIndex)
    : await getNextReplaySegmentIndex(webcamFolderName);

  const fileName = basename(segmentPath);
  let sizeBytes = 0;

  try {
    const stat = await RNFS.stat(segmentPath);
    sizeBytes = Number(stat.size || 0);
  } catch {}

  manifest.matchSessionId = options.matchSessionId || manifest.matchSessionId;
  manifest.keepFullMatch = Boolean(options.keepFullMatch);
  manifest.updatedAt = Date.now();
  manifest.segments = [
    ...manifest.segments.filter(item => item.segmentIndex !== segmentIndex),
    {
      segmentIndex,
      fileName,
      createdAt: Date.now(),
      sizeBytes,
    },
  ].sort((a, b) => a.segmentIndex - b.segmentIndex);

  manifests.set(webcamFolderName, manifest);

  console.log('[Windows Replay] register segment:', {
    webcamFolderName,
    segmentPath,
    segmentIndex,
    sizeBytes,
  });

  try {
    const manifestPath = `${buildReplayFolderPath(webcamFolderName)}/${MATCH_MANIFEST_FILE_NAME}`;
    await RNFS.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch (error) {
    console.log('[Windows Replay] manifest write failed:', error);
  }

  return segmentPath;
};

export const exportMatchToArchive = async (_webcamFolderName: string) => {
  return undefined;
};

export const pruneReplayStorage = async (
  _maxBytes = MAX_REPLAY_STORAGE_BYTES,
  _protectedFolderNames: string[] = [],
) => {
  return {
    totalBytes: 0,
    deleted: [],
  };
};

export const deleteReplayFolder = async (
  webcamFolderName?: string,
  _options?: {includeArchive?: boolean},
) => {
  if (webcamFolderName) {
    manifests.delete(webcamFolderName);
    try {
      const folderPath = buildReplayFolderPath(webcamFolderName);
      if (await RNFS.exists(folderPath)) {
        await RNFS.unlink(folderPath);
      }
    } catch {}
  }
};
