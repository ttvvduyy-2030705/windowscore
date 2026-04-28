import RNFS from 'react-native-fs';
import {ensureArchiveFolder} from 'services/replay/localReplay';

export type ReplayScoreboardTimelineEntry = {
  segmentIndex: number;
  segmentTime: number;
  currentPlayerIndex: number;
  countdownTime: number;
  baseCountdown?: number;
  category?: any;
  gameMode?: any;
  goal?: number;
  playerSettings?: any;
  totalTurns?: number;
  savedAt?: number;
};

export type ReplayScoreboardTimelineFile = {
  version: 1;
  webcamFolderName: string;
  updatedAt: number;
  entries: ReplayScoreboardTimelineEntry[];
};

const TIMELINE_FILE_NAME = 'scoreboard_timeline.json';
const MAX_TIMELINE_ENTRIES = 7200;
const REPLACE_DELTA_SECONDS = 0.8;
const FLUSH_DEBOUNCE_MS = 3000;

const timelineCache = new Map<string, ReplayScoreboardTimelineFile>();
const flushTimeouts = new Map<string, NodeJS.Timeout>();
const flushQueues = new Map<string, Promise<void>>();

const clone = <T,>(value: T): T => {
  if (value == null) {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (_error) {
    return value;
  }
};

const getTimelinePath = async (webcamFolderName: string) => {
  // On Windows, keep the overlay timeline with the long-term History files.
  // ReplayTemp is allowed to be deleted, but History must survive app restart.
  const historyFolderPath = await ensureArchiveFolder(webcamFolderName);
  return `${historyFolderPath}/${TIMELINE_FILE_NAME}`;
};

const normalizeTimeline = (
  webcamFolderName: string,
  payload?: Partial<ReplayScoreboardTimelineFile> | null,
): ReplayScoreboardTimelineFile => {
  const entries = Array.isArray(payload?.entries)
    ? payload!.entries
        .filter(Boolean)
        .map(item => ({
          segmentIndex: Number(item.segmentIndex || 0),
          segmentTime: Number(item.segmentTime || 0),
          currentPlayerIndex: Number(item.currentPlayerIndex || 0),
          countdownTime: Number(item.countdownTime || 0),
          baseCountdown:
            item.baseCountdown == null ? undefined : Number(item.baseCountdown),
          category: item.category,
          gameMode: item.gameMode,
          goal: item.goal == null ? undefined : Number(item.goal),
          playerSettings: clone(item.playerSettings),
          totalTurns: item.totalTurns == null ? undefined : Number(item.totalTurns),
          savedAt: item.savedAt == null ? undefined : Number(item.savedAt),
        }))
        .sort((a, b) => {
          if (a.segmentIndex !== b.segmentIndex) {
            return a.segmentIndex - b.segmentIndex;
          }
          return a.segmentTime - b.segmentTime;
        })
    : [];

  return {
    version: 1,
    webcamFolderName,
    updatedAt: Date.now(),
    entries,
  };
};

export const loadReplayScoreboardTimeline = async (
  webcamFolderName?: string,
): Promise<ReplayScoreboardTimelineFile | null> => {
  if (!webcamFolderName) {
    return null;
  }

  const cached = timelineCache.get(webcamFolderName);
  if (cached) {
    return clone(cached);
  }

  try {
    const timelinePath = await getTimelinePath(webcamFolderName);
    if (!(await RNFS.exists(timelinePath))) {
      const emptyTimeline = normalizeTimeline(webcamFolderName, null);
      timelineCache.set(webcamFolderName, emptyTimeline);
      console.log('[ReplayOverlaySync]', {
        event: 'timelineMissing',
        webcamFolderName,
        timelinePath,
        usingLiveState: false,
      });
      console.log('[HistoryOverlaySync]', {
        event: 'timelineMissing',
        webcamFolderName,
        timelinePath,
        usingLiveState: false,
      });
      return clone(emptyTimeline);
    }

    const raw = await RNFS.readFile(timelinePath, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizeTimeline(webcamFolderName, parsed);
    timelineCache.set(webcamFolderName, normalized);
    console.log('[HistoryOverlaySync]', {
      event: 'timelineLoaded',
      webcamFolderName,
      timelinePath,
      overlayTimelineEventsCount: normalized.entries.length,
      usingLiveState: false,
    });
    return clone(normalized);
  } catch (error) {
    console.log('[ReplayTimeline] load failed:', error);
    const fallback = normalizeTimeline(webcamFolderName, null);
    timelineCache.set(webcamFolderName, fallback);
    return clone(fallback);
  }
};

const persistReplayScoreboardTimeline = async (
  webcamFolderName: string,
  timeline: ReplayScoreboardTimelineFile,
) => {
  const timelinePath = await getTimelinePath(webcamFolderName);
  await RNFS.writeFile(timelinePath, JSON.stringify(timeline), 'utf8');
  console.log('[HistoryOverlaySync]', {
    event: 'timelineSaved',
    webcamFolderName,
    overlayTimelinePath: timelinePath,
    overlayTimelineEventsCount: timeline.entries.length,
    usingLiveState: false,
  });
};

const queueTimelineFlush = (webcamFolderName: string) => {
  const existing = flushQueues.get(webcamFolderName) || Promise.resolve();
  const next = existing
    .catch(() => undefined)
    .then(async () => {
      const timeline = timelineCache.get(webcamFolderName);
      if (!timeline) {
        return;
      }

      await persistReplayScoreboardTimeline(webcamFolderName, timeline);
    });

  flushQueues.set(
    webcamFolderName,
    next.catch(error => {
      console.log('[ReplayTimeline] persist failed:', error);
    }),
  );

  return next;
};

const scheduleReplayScoreboardTimelineFlush = (webcamFolderName: string) => {
  const existingTimeout = flushTimeouts.get(webcamFolderName);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  const timeout = setTimeout(() => {
    flushTimeouts.delete(webcamFolderName);
    void queueTimelineFlush(webcamFolderName);
  }, FLUSH_DEBOUNCE_MS);

  flushTimeouts.set(webcamFolderName, timeout);
};

export const flushReplayScoreboardTimeline = async (webcamFolderName?: string) => {
  if (!webcamFolderName) {
    return;
  }

  const existingTimeout = flushTimeouts.get(webcamFolderName);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    flushTimeouts.delete(webcamFolderName);
  }

  await queueTimelineFlush(webcamFolderName);
};

export const appendReplayScoreboardTimelineEntry = async (
  webcamFolderName?: string,
  entry?: ReplayScoreboardTimelineEntry | null,
) => {
  if (!webcamFolderName || !entry) {
    return;
  }

  const existingTimeline =
    timelineCache.get(webcamFolderName) ||
    (await loadReplayScoreboardTimeline(webcamFolderName)) ||
    normalizeTimeline(webcamFolderName, null);

  const normalizedEntry: ReplayScoreboardTimelineEntry = {
    segmentIndex: Number(entry.segmentIndex || 0),
    segmentTime: Number(entry.segmentTime || 0),
    currentPlayerIndex: Number(entry.currentPlayerIndex || 0),
    countdownTime: Number(entry.countdownTime || 0),
    baseCountdown:
      entry.baseCountdown == null ? undefined : Number(entry.baseCountdown),
    category: entry.category,
    gameMode: entry.gameMode,
    goal: entry.goal == null ? undefined : Number(entry.goal),
    playerSettings: clone(entry.playerSettings),
    totalTurns: entry.totalTurns == null ? undefined : Number(entry.totalTurns),
    savedAt: entry.savedAt == null ? Date.now() : Number(entry.savedAt),
  };

  const entries = [...existingTimeline.entries];
  const lastEntry = entries[entries.length - 1];
  const shouldReplaceLast =
    !!lastEntry &&
    lastEntry.segmentIndex === normalizedEntry.segmentIndex &&
    Math.abs(lastEntry.segmentTime - normalizedEntry.segmentTime) <
      REPLACE_DELTA_SECONDS;

  if (shouldReplaceLast) {
    entries[entries.length - 1] = normalizedEntry;
  } else {
    entries.push(normalizedEntry);
  }

  const compactedEntries =
    entries.length > MAX_TIMELINE_ENTRIES
      ? entries.slice(entries.length - MAX_TIMELINE_ENTRIES)
      : entries;

  const nextTimeline = normalizeTimeline(webcamFolderName, {
    version: 1,
    webcamFolderName,
    updatedAt: Date.now(),
    entries: compactedEntries,
  });

  timelineCache.set(webcamFolderName, nextTimeline);
  console.log('[ReplayOverlaySync]', {
    event: 'timelineAppend',
    webcamFolderName,
    selectedOverlayEventTimeMs: Math.round(normalizedEntry.segmentTime * 1000),
    selectedScoreSnapshot: {
      currentPlayerIndex: normalizedEntry.currentPlayerIndex,
      countdownTime: normalizedEntry.countdownTime,
      totalTurns: normalizedEntry.totalTurns,
    },
    usingLiveState: false,
  });
  scheduleReplayScoreboardTimelineFlush(webcamFolderName);
};
