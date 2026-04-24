export const RECORDING_SEGMENT_DURATION_MS = 2 * 60 * 1000;
export const MAX_REPLAY_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;
export const REPLAY_WINDOW_SEGMENTS = 3;

export const REPLAY_ROOT = 'C:/AplusScoreWindows/ReplayBuffer';
export const ARCHIVE_ROOT = 'C:/AplusScoreWindows/SavedVideos';

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

export const buildReplayFolderPath = (webcamFolderName: string) => {
  return `${REPLAY_ROOT}/${webcamFolderName}`;
};

export const buildArchiveFolderPath = (webcamFolderName: string) => {
  return `${ARCHIVE_ROOT}/${webcamFolderName}`;
};

export const buildLegacyReplayFolderPath = buildReplayFolderPath;

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

export const ensureReplayRoot = async () => undefined;

export const ensureReplayFolder = async (webcamFolderName: string) => {
  return buildReplayFolderPath(webcamFolderName);
};

export const ensureArchiveFolder = async (webcamFolderName: string) => {
  return buildArchiveFolderPath(webcamFolderName);
};

export const resolveReplayFolder = async (webcamFolderName: string) => {
  return buildReplayFolderPath(webcamFolderName);
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

export const listReplayFiles = async (_webcamFolderName: string) => {
  return [];
};

export const listArchiveFiles = async (_webcamFolderName: string) => {
  return [];
};

export const listPlayableFiles = async (
  _webcamFolderName: string,
  _preferArchive = false,
) => {
  return [];
};

export const waitForReplayFiles = async (
  _webcamFolderName: string,
  _minCount = 1,
  _timeoutMs = 8000,
) => {
  return [];
};

export const registerReplaySegment = async (
  webcamFolderName: string,
  segmentPath: string,
  options: RegisterReplaySegmentOptions = {},
) => {
  const manifest = getManifest(webcamFolderName);

  const segmentIndex = Number.isFinite(options.segmentIndex)
    ? Number(options.segmentIndex)
    : await getNextReplaySegmentIndex(webcamFolderName);

  const fileName = basename(segmentPath);

  manifest.matchSessionId = options.matchSessionId || manifest.matchSessionId;
  manifest.keepFullMatch = Boolean(options.keepFullMatch);
  manifest.updatedAt = Date.now();
  manifest.segments = [
    ...manifest.segments.filter(item => item.segmentIndex !== segmentIndex),
    {
      segmentIndex,
      fileName,
      createdAt: Date.now(),
      sizeBytes: 0,
    },
  ].sort((a, b) => a.segmentIndex - b.segmentIndex);

  manifests.set(webcamFolderName, manifest);

  console.log('[Windows Replay] register segment skipped:', {
    webcamFolderName,
    segmentPath,
    segmentIndex,
  });

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
  }
};