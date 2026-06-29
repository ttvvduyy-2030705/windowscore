import {useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Alert, Platform} from 'react-native';
import {useSelector, useDispatch} from 'react-redux';
import RNFS from 'react-native-fs';
// import {captureRef} from 'react-native-view-shot';
import {useRealm} from '@realm/react';
import {RootState} from 'data/redux/reducers';
import {gameActions} from 'data/redux/actions/game';
import i18n from 'i18n';
import {LanguageContext} from 'context/language';
import {Camera} from 'react-native-vision-camera';
import {goBack} from 'utils/navigation';
import {
  isPool10Game,
  isPool15FreeGame,
  isPool15Game,
  isPool15OnlyGame,
  isPool9Game,
  isPoolGame,
  isCaromGame,
} from 'utils/game';
import Sound from 'utils/sound';
import RemoteControl from 'utils/remote';
import {Player, PlayerSettings} from 'types/player';
import {GameSettings} from 'types/settings';
import {RemoteControlKeys} from 'types/bluetooth';
import {BallType, PoolBallType} from 'types/ball';
//import {MATCH_COUNTDOWN, WEBCAM_BASE_CAMERA_FOLDER} from 'constants/webcam';
import {NativeModules} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import {LIVESTREAM_ACCOUNT_STORAGE_KEY} from 'config/livestreamAuth';
import {
  RECORDING_SEGMENT_DURATION_MS,
  MAX_REPLAY_STORAGE_BYTES,
  deleteReplayFolder,
  exportMatchToArchive,
  getNextReplaySegmentIndex,
  registerReplaySegment,
  pruneReplayStorage,
  listReplayFiles,
  listPlayableFiles,
  cleanupBrokenReplayFiles,
  waitForReplayFiles,
} from 'services/replay/localReplay';
import {
  appendReplayScoreboardTimelineEntry,
  flushReplayScoreboardTimeline,
  loadReplayScoreboardTimeline,
} from 'services/replay/replayTimeline';
import {screens} from 'scenes/screens';
import {navigate, push} from 'utils/navigation';
import {
  createYouTubeLiveSession,
  getYouTubeLiveEligibility,
  stopYouTubeLiveSession,
  type YouTubeEligibilityCheck,
  type YouTubeEligibilityResponse,
} from 'services/youtubeLiveFlow';
import {
  isYouTubeNativeLiveEngineMounted,
  isYouTubeNativeLiveReady,
  isYouTubeNativePreviewViewAvailable,
  startYouTubeNativeLive,
  stopYouTubeNativeLive,
  subscribeYouTubeNativeLiveState,
} from 'services/youtubeNativeLive';
import {
  DEFAULT_YOUTUBE_RTMP_URL,
  createWindowsFfmpegSnapshotFromGameState,
  maskStreamKey,
  startWindowsFfmpegYouTubeLive,
  stopWindowsFfmpegYouTubeLive,
  updateWindowsFfmpegOverlay,
  type WindowsFfmpegLiveConfig,
} from 'services/livestream/WindowsFfmpegLiveEngine';
import {
  pushAplusLiveScoreUpdate,
  heartbeatAplusLiveScoreMatch,
  finishAplusLiveScoreMatch,
  releaseAplusLiveScoreMatch,
  bootstrapAplusLiveScoreOutbox,
} from 'services/aplusLiveScore';

let countdownInterval: NodeJS.Timeout, warmUpCountdownInterval: NodeJS.Timeout;
const {CameraService} = NativeModules;

const getSafeRunPoint = (value?: number) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const getTopTwoRuns = (player: Player, currentPoint: number) => {
  const runs = [
    getSafeRunPoint(player.proMode?.highestRate),
    getSafeRunPoint(player.proMode?.secondHighestRate),
    getSafeRunPoint(currentPoint),
  ].sort((a, b) => b - a);

  return {
    highestRate: runs[0] || 0,
    secondHighestRate: runs[1] || 0,
  };
};

const commitCurrentRunStatsForPlayers = (
  settings?: PlayerSettings,
  totalTurnsValue?: number,
): PlayerSettings | undefined => {
  if (!settings?.playingPlayers?.length) {
    return settings;
  }

  const completedTurns = Math.max(1, Number(totalTurnsValue || 0) + 1);

  return {
    ...settings,
    playingPlayers: settings.playingPlayers.map(player => {
      const currentPoint = getSafeRunPoint(player.proMode?.currentPoint);

      if (!player.proMode || currentPoint <= 0) {
        return player;
      }

      const {highestRate, secondHighestRate} = getTopTwoRuns(player, currentPoint);
      const average = Number(
        (Number(player.totalPoint || 0) / completedTurns).toFixed(2),
      );

      return {
        ...player,
        proMode: {
          ...player.proMode,
          highestRate,
          secondHighestRate,
          average,
          currentPoint: 0,
        },
      };
    }),
  };
};

const playCountdownBeepSafely = () => {
  try {
    const soundModule = Sound as any;

    if (typeof soundModule?.beep === 'function') {
      soundModule.beep();
      return;
    }

    console.log('[WindowsVideoCrashGuard]', {
      component: 'GamePlayViewModel',
      reason: 'Sound.beep is not available on this platform; skipped countdown beep',
      preventedRedScreen: true,
    });
  } catch (error) {
    console.log('[WindowsVideoCrashGuard]', {
      component: 'GamePlayViewModel',
      reason: 'Sound.beep threw; skipped countdown beep',
      preventedRedScreen: true,
      error,
    });
  }
};

type Visibility = 'public' | 'private' | 'unlisted';

type StoredSetup = {
  accountName?: string;
  visibility?: Visibility;
  accountId?: string;
  setupToken?: string;
};

type StorageShape = {
  facebook?: StoredSetup;
  youtube?: StoredSetup;
  tiktok?: StoredSetup;
};

type GameplayLiveRouteParams = {
  gameSettings?: GameSettings;
  livestreamPlatform?: 'facebook' | 'youtube' | 'tiktok' | 'device' | null;
  saveToDeviceWhileStreaming?: boolean;
  liveVisibility?: 'public' | 'private' | 'unlisted';
  liveAccountName?: string;
  liveAccountId?: string;
  liveSetupToken?: string;
  gameplaySessionKey?: string;
  forceNewGameplaySession?: boolean;
};

const normalizeGameplayLivestreamPlatform = (value: any) => {
  return value === 'facebook' ||
    value === 'youtube' ||
    value === 'tiktok' ||
    value === 'device'
    ? value
    : null;
};


const DEBUG_MATCH_RESTORE = false;
const debugMatchRestoreLog = (...args: any[]) => {
  if (__DEV__ && DEBUG_MATCH_RESTORE) {
    console.log(...args);
  }
};

const setYouTubeNativeCameraLock = (locked: boolean) => {
  (globalThis as any).__APLUS_YOUTUBE_NATIVE_LOCK__ = locked;
};


const getCurrentCameraSource = (): 'back' | 'front' | 'external' => {
  const value = (globalThis as any).__APLUS_CURRENT_CAMERA_SOURCE__;
  return value === 'front' || value === 'external' ? value : 'back';
};

const setYouTubeSourceLock = (source: 'back' | 'front' | 'external' | null) => {
  (globalThis as any).__APLUS_YOUTUBE_SOURCE_LOCK__ = source;
};

const withEndMatchTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T | undefined> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`${label}_TIMEOUT_${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    console.log('[END] background/timeout skipped:', {
      label,
      timeoutMs,
      message: (error as Error)?.message || String(error),
    });
    return undefined;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const hasDetectedUvcSource = () => {
  return (globalThis as any).__APLUS_UVC_PRESENT__ === true;
};

const getAvailableCameraSources = (): Array<'back' | 'front' | 'external'> => {
  const sources = (globalThis as any).__APLUS_AVAILABLE_CAMERA_SOURCES__;
  return Array.isArray(sources) ? sources : [];
};

const normalizeAvailableCameraSources = (
  sources: Array<'back' | 'front' | 'external'>,
): Array<'back' | 'front' | 'external'> => {
  return Array.from(new Set(sources)).filter(
    (source): source is 'back' | 'front' | 'external' =>
      source === 'back' || source === 'front' || source === 'external',
  );
};

const resolveLockedLiveSource = (
  currentSource: 'back' | 'front' | 'external',
  availableSources: Array<'back' | 'front' | 'external'>,
): 'back' | 'front' | 'external' | null => {
  const normalizedSources = normalizeAvailableCameraSources(availableSources);
  const hasExternal =
    hasDetectedUvcSource() && normalizedSources.includes('external');

  if (currentSource === 'external') {
    return hasExternal ? 'external' : null;
  }

  if (currentSource === 'back' && normalizedSources.includes('back')) {
    return 'back';
  }

  if (currentSource === 'front' && normalizedSources.includes('front')) {
    return 'front';
  }

  if (normalizedSources.includes('back')) {
    return 'back';
  }

  if (normalizedSources.includes('front')) {
    return 'front';
  }

  if (currentSource === 'front' || currentSource === 'back') {
    return currentSource;
  }

  return null;
};


const LIVE_SNAPSHOT_SYNC_MIN_MS = 5000;
const REPLAY_TIMELINE_TIME_BUCKET_SECONDS = 3;
const REPLAY_TIMELINE_COUNTDOWN_BUCKET_SECONDS = 3;
const REPLAY_PRUNE_EVERY_N_SEGMENTS = 3;
const ENABLE_SEGMENT_OVERLAY_BURN = false;
const REPLAY_RETURN_CAMERA_STABILIZE_MS = 900;

type ReplayResumeSnapshot = {
  matchSessionId?: string;
  webcamFolderName?: string;
  currentPlayerIndex: number;
  poolBreakPlayerIndex: number;
  totalTurns: number;
  totalTime: number;
  countdownTime: number;
  warmUpCount?: number;
  warmUpCountdownTime?: number;
  playerSettings?: PlayerSettings;
  winner?: Player;
  isStarted: boolean;
  isPaused: boolean;
  isMatchPaused: boolean;
  gameBreakEnabled: boolean;
  poolBreakEnabled: boolean;
  soundEnabled: boolean;
  proModeEnabled: boolean;
  restoreOnNextFocus?: boolean;
  savedAt?: number;
  aplusLiveMatchIdentity?: string;
};

type ReplayReturnRequest = {
  matchSessionId?: string;
  webcamFolderName?: string;
  requestedAt?: number;
};

type Pool8Tracker = {
  sequence: BallType[];
  activeIndex: number;
};

const DEFAULT_POOL8_LEFT_SEQUENCE: BallType[] = [
  BallType.B1,
  BallType.B2,
  BallType.B3,
  BallType.B4,
  BallType.B5,
  BallType.B6,
  BallType.B7,
  BallType.B8,
];

const DEFAULT_POOL8_RIGHT_SEQUENCE: BallType[] = [
  BallType.B9,
  BallType.B10,
  BallType.B11,
  BallType.B12,
  BallType.B13,
  BallType.B14,
  BallType.B15,
  BallType.B8,
];

const buildDefaultPool8Trackers = (): Pool8Tracker[] => [
  {sequence: [...DEFAULT_POOL8_LEFT_SEQUENCE], activeIndex: 0},
  {sequence: [...DEFAULT_POOL8_RIGHT_SEQUENCE], activeIndex: 0},
];

const getSafePool8Trackers = (trackers?: Pool8Tracker[] | null): Pool8Tracker[] =>
  Array.isArray(trackers) && trackers.length > 0
    ? trackers
    : buildDefaultPool8Trackers();

const resetPool8Trackers = (trackers?: Pool8Tracker[] | null): Pool8Tracker[] =>
  getSafePool8Trackers(trackers).map(tracker => ({...tracker, activeIndex: 0}));

const REPLAY_RESUME_SNAPSHOT_STORAGE_KEY =
  '@APLUS_REPLAY_RESUME_SNAPSHOT_V3';

const LIVE_MATCH_SNAPSHOT_STORAGE_KEY = '@APLUS_LIVE_MATCH_SNAPSHOT_V1';

type LiveMatchSnapshot = ReplayResumeSnapshot & {
  configSignature?: string;
  aplusLiveMatchIdentity?: string;
};

const getAplusLiveMatchIdentityFromSettings = (settings: any) => {
  const config = settings?.aplusLiveScore;
  const matchId = String(config?.matchId || '').trim();

  if (!matchId) {
    return '';
  }

  return [
    String(config?.tournamentId || '').trim(),
    matchId,
    String(config?.matchNumber || config?.matchCode || '').trim(),
  ].join('|');
};

const buildGameSettingsSignature = (settings: any) => {
  try {
    return JSON.stringify({
      category: settings?.category ?? null,
      mode: settings?.mode ?? null,
      playerNumber: settings?.players?.playerNumber ?? null,
      goal: settings?.players?.goal?.goal ?? null,
      aplusLiveMatchIdentity: getAplusLiveMatchIdentityFromSettings(settings),
      playerNames: (settings?.players?.playingPlayers || [])
        .slice(0, 2)
        .map((player: any) => ({
          name: String(player?.name || ''),
          countryCode: String(player?.countryCode || player?.flag || ''),
        })),
    });
  } catch (_error) {
    return undefined;
  }
};

const setLiveMatchSnapshotSync = (snapshot: LiveMatchSnapshot | null) => {
  (globalThis as any).__APLUS_LIVE_MATCH_SNAPSHOT__ = snapshot
    ? cloneReplayValue(snapshot)
    : null;
};

const getLiveMatchSnapshotSync = (): LiveMatchSnapshot | null => {
  const snapshot = (globalThis as any).__APLUS_LIVE_MATCH_SNAPSHOT__;
  return snapshot ? cloneReplayValue(snapshot) : null;
};

const clearPersistedLiveMatchSnapshot = async () => {
  try {
    await AsyncStorage.removeItem(LIVE_MATCH_SNAPSHOT_STORAGE_KEY);
  } catch (error) {
    console.log('[Live Match] Failed to clear persisted snapshot:', error);
  }
};

const setLiveMatchSnapshot = async (snapshot: LiveMatchSnapshot | null) => {
  const normalizedSnapshot = snapshot ? cloneReplayValue(snapshot) : null;
  setLiveMatchSnapshotSync(normalizedSnapshot);

  if (!normalizedSnapshot) {
    await clearPersistedLiveMatchSnapshot();
  }
};

const getLiveMatchSnapshot = async (): Promise<LiveMatchSnapshot | null> => {
  const runtimeSnapshot = getLiveMatchSnapshotSync();
  return runtimeSnapshot ? cloneReplayValue(runtimeSnapshot) : null;
};

const isLiveMatchSnapshotUsable = (
  snapshot: LiveMatchSnapshot | null,
  expectedConfigSignature?: string,
  expectedAplusLiveMatchIdentity = '',
) => {
  if (!snapshot?.playerSettings) {
    return false;
  }

  if (snapshot.savedAt && Date.now() - snapshot.savedAt > 6 * 60 * 60 * 1000) {
    return false;
  }

  if (expectedAplusLiveMatchIdentity) {
    if (snapshot.aplusLiveMatchIdentity !== expectedAplusLiveMatchIdentity) {
      return false;
    }
  } else if (snapshot.aplusLiveMatchIdentity) {
    return false;
  }

  if (
    expectedConfigSignature &&
    snapshot.configSignature &&
    snapshot.configSignature !== expectedConfigSignature
  ) {
    return false;
  }

  return true;
};

const cloneReplayValue = <T,>(value: T): T => {
  if (value == null) {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (_error) {
    return value;
  }
};


const getFinalScoreSnapshot = (settings?: PlayerSettings | null) => {
  const players = Array.isArray(settings?.playingPlayers)
    ? settings!.playingPlayers
    : [];

  return players.map((player: any) =>
    Number(player?.totalPoint ?? player?.point ?? 0),
  );
};

const getScoreSnapshotTotal = (score?: number[] | null) =>
  Array.isArray(score)
    ? score.reduce((sum, value) => sum + Number(value || 0), 0)
    : 0;

const getScoreSnapshotFromPlayerSettings = (settings?: PlayerSettings | null) =>
  getFinalScoreSnapshot(settings);

const deriveWinnerPlayerFromScore = (
  settings?: PlayerSettings | null,
  finalScore?: number[],
): Player | undefined => {
  const players = Array.isArray(settings?.playingPlayers)
    ? settings!.playingPlayers
    : [];

  if (!players.length) {
    return undefined;
  }

  const scoreSource = Array.isArray(finalScore) && finalScore.length
    ? finalScore
    : getFinalScoreSnapshot(settings);

  if (!Array.isArray(scoreSource) || !scoreSource.length) {
    return players[0];
  }

  let winnerIndex = 0;
  let winnerScore = Number(scoreSource[0] || 0);

  scoreSource.forEach((score, index) => {
    if (Number(score || 0) > winnerScore) {
      winnerIndex = index;
      winnerScore = Number(score || 0);
    }
  });

  return players[winnerIndex];
};

const deriveWinnerNameFromScore = (
  settings?: PlayerSettings | null,
  finalScore?: number[],
) => deriveWinnerPlayerFromScore(settings, finalScore)?.name;

const getTargetGoalValue = (settings?: GameSettings | null) => {
  const rawGoal = settings?.players?.goal?.goal;
  const goal = Number(rawGoal || 0);
  return Number.isFinite(goal) && goal > 0 ? goal : 0;
};

const clampScoreDeltaToGoal = (
  currentScore: number,
  requestedDelta: number,
  targetGoal: number,
) => {
  const safeCurrent = Number.isFinite(currentScore) ? currentScore : 0;
  const safeDelta = Number.isFinite(requestedDelta) ? requestedDelta : 0;

  if (safeDelta > 0 && targetGoal > 0) {
    return Math.min(targetGoal, safeCurrent + safeDelta) - safeCurrent;
  }

  if (safeDelta < 0) {
    return Math.max(0, safeCurrent + safeDelta) - safeCurrent;
  }

  return safeDelta;
};

const setReplayResumeSnapshotSync = (snapshot: ReplayResumeSnapshot | null) => {
  (globalThis as any).__APLUS_REPLAY_RESUME_SNAPSHOT__ = snapshot
    ? cloneReplayValue(snapshot)
    : null;
};

const getReplayResumeSnapshotSync = (): ReplayResumeSnapshot | null => {
  const snapshot = (globalThis as any).__APLUS_REPLAY_RESUME_SNAPSHOT__;
  return snapshot ? cloneReplayValue(snapshot) : null;
};

const setReplayReturnRequestSync = (
  request: ReplayReturnRequest | null,
) => {
  (globalThis as any).__APLUS_REPLAY_RETURN_REQUEST__ = request
    ? cloneReplayValue(request)
    : null;
};

const getReplayReturnRequestSync = (): ReplayReturnRequest | null => {
  const request = (globalThis as any).__APLUS_REPLAY_RETURN_REQUEST__;
  return request ? cloneReplayValue(request) : null;
};


type ActiveGameplaySession = {
  matchSessionId?: string;
  webcamFolderName?: string;
  savedAt?: number;
  source?: string;
  aplusLiveMatchIdentity?: string;
};

const ACTIVE_GAMEPLAY_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const setActiveGameplaySessionSync = (session: ActiveGameplaySession | null) => {
  (globalThis as any).__APLUS_ACTIVE_GAMEPLAY_SESSION__ = session
    ? cloneReplayValue({
        ...session,
        savedAt: session.savedAt || Date.now(),
      })
    : null;
};

const getActiveGameplaySessionSync = (): ActiveGameplaySession | null => {
  const session = (globalThis as any).__APLUS_ACTIVE_GAMEPLAY_SESSION__;
  return session ? cloneReplayValue(session) : null;
};

const clearActiveGameplaySessionSync = () => {
  setActiveGameplaySessionSync(null);
};

const isActiveGameplaySessionReusable = (
  session: ActiveGameplaySession | null,
  expectedAplusLiveMatchIdentity = '',
) => {
  if (!session?.matchSessionId || !session?.webcamFolderName) {
    return false;
  }

  if (session.savedAt && Date.now() - session.savedAt > ACTIVE_GAMEPLAY_SESSION_MAX_AGE_MS) {
    return false;
  }

  if (expectedAplusLiveMatchIdentity) {
    return session.aplusLiveMatchIdentity === expectedAplusLiveMatchIdentity;
  }

  // Không cho trận thường/local tái dùng session của một trận Aplus trước đó.
  if (session.aplusLiveMatchIdentity) {
    return false;
  }

  return true;
};

const setReplayResumeSnapshot = async (
  snapshot: ReplayResumeSnapshot | null,
) => {
  const normalizedSnapshot = snapshot ? cloneReplayValue(snapshot) : null;
  setReplayResumeSnapshotSync(normalizedSnapshot);

  try {
    if (normalizedSnapshot) {
      await AsyncStorage.setItem(
        REPLAY_RESUME_SNAPSHOT_STORAGE_KEY,
        JSON.stringify(normalizedSnapshot),
      );
    } else {
      await AsyncStorage.removeItem(REPLAY_RESUME_SNAPSHOT_STORAGE_KEY);
    }
  } catch (error) {
    console.log('[Replay] Failed to persist resume snapshot:', error);
  }
};

const getReplayResumeSnapshot = async (): Promise<ReplayResumeSnapshot | null> => {
  const runtimeSnapshot = getReplayResumeSnapshotSync();
  if (runtimeSnapshot) {
    return runtimeSnapshot;
  }

  try {
    const rawSnapshot = await AsyncStorage.getItem(
      REPLAY_RESUME_SNAPSHOT_STORAGE_KEY,
    );

    if (!rawSnapshot) {
      return null;
    }

    const parsedSnapshot = JSON.parse(rawSnapshot) as ReplayResumeSnapshot;
    setReplayResumeSnapshotSync(parsedSnapshot);
    return cloneReplayValue(parsedSnapshot);
  } catch (error) {
    console.log('[Replay] Failed to load resume snapshot:', error);
    return null;
  }
};

const isReplayResumeSnapshotReusable = (
  snapshot: ReplayResumeSnapshot | null,
) => {
  if (!snapshot?.webcamFolderName) {
    return false;
  }

  if (!snapshot.isPaused) {
    return false;
  }

  if (snapshot.savedAt && Date.now() - snapshot.savedAt > 30 * 60 * 1000) {
    return false;
  }

  return true;
};

const isReplayResumeSnapshotMatch = (
  snapshot: ReplayResumeSnapshot | null,
  expectedFolderName?: string | null,
  expectedMatchSessionId?: string | null,
  expectedAplusLiveMatchIdentity = '',
) => {
  if (!isReplayResumeSnapshotReusable(snapshot)) {
    return false;
  }

  if (expectedAplusLiveMatchIdentity) {
    if (snapshot?.aplusLiveMatchIdentity !== expectedAplusLiveMatchIdentity) {
      return false;
    }
  } else if (snapshot?.aplusLiveMatchIdentity) {
    return false;
  }

  if (
    expectedMatchSessionId &&
    snapshot?.matchSessionId &&
    snapshot.matchSessionId === expectedMatchSessionId
  ) {
    return true;
  }

  if (!expectedFolderName) {
    return true;
  }

  return expectedFolderName === snapshot.webcamFolderName;
};

const GamePlayViewModel = () => {
  const {language} = useContext(LanguageContext);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const routeParams = (route?.params || {}) as GameplayLiveRouteParams;
  const realm = useRealm();
  const dispatch = useDispatch();
  const {updateGameSettings} = useSelector((state: RootState) => state.UI.game);
  const {gameSettings: reduxGameSettings} = useSelector((state: RootState) => state.game);
  const routeGameSettings = routeParams.gameSettings;
  const gameSettings = useMemo(
    () => routeGameSettings ?? reduxGameSettings,
    [routeGameSettings, reduxGameSettings],
  );
  const selectedLivestreamPlatform =
    (normalizeGameplayLivestreamPlatform(routeParams.livestreamPlatform) ||
      normalizeGameplayLivestreamPlatform((gameSettings as any)?.livestreamPlatform) ||
      null) as 'facebook' | 'youtube' | 'tiktok' | 'device' | null;
  const saveToDeviceWhileStreaming = Boolean(
    routeParams.saveToDeviceWhileStreaming ??
      (gameSettings as any)?.saveToDeviceWhileStreaming ??
      false,
  );
  const shouldUseYouTubeLive = selectedLivestreamPlatform === 'youtube';
  const shouldUseLocalRecordingOnly = selectedLivestreamPlatform !== 'youtube';
  const currentAplusLiveMatchIdentity = useMemo(
    () => getAplusLiveMatchIdentityFromSettings(gameSettings),
    [
      (gameSettings as any)?.aplusLiveScore?.tournamentId,
      (gameSettings as any)?.aplusLiveScore?.matchId,
      (gameSettings as any)?.aplusLiveScore?.matchNumber,
    ],
  );

  const gameSettingsSignature = useMemo(() => {
    return buildGameSettingsSignature(gameSettings);
  }, [
    gameSettings?.category,
    gameSettings?.mode,
    gameSettings?.players?.playerNumber,
    gameSettings?.players?.goal?.goal,
    currentAplusLiveMatchIdentity,
  ]);
  const cameraRef = useRef<Camera>(null);
  const matchCountdownRef = useRef(null);
  const recordingRotateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recordingStartRetryRef = useRef<NodeJS.Timeout | null>(null);
  const restartAfterStopRef = useRef(false);
  const isRecordingRef = useRef(false);
  const isStoppingRecordingRef = useRef(false);
  const pendingStartRecordingRef = useRef(false);
  const lastRecordedVideoPathRef = useRef<string | undefined>(undefined);
  const replayCompletedSegmentsRef = useRef(0);
  const currentReplaySegmentIndexRef = useRef(0);
  const currentReplaySegmentStartTotalTimeRef = useRef(0);
  const currentReplaySegmentWallStartMsRef = useRef(0);
  const totalTimeRef = useRef(0);
  const totalTurnsRef = useRef(1);
  const playerSettingsRef = useRef<PlayerSettings | undefined>(undefined);
  const winnerRef = useRef<Player | undefined>(undefined);
  const activeMatchFolderNameRef = useRef<string | null>(null);
  const replayTimelineSignatureRef = useRef('');
  const lastLiveSnapshotSignatureRef = useRef('');
  const lastLiveSnapshotSyncAtRef = useRef(0);
  const lastReplayTimelineWriteSignatureRef = useRef('');
  const lastPruneCompletedSegmentsRef = useRef(0);
  const quickMatchRemoteStopRef = useRef<(() => void) | null>(null);
  const remoteHandlersRef = useRef({
    start: () => {},
    warmUp: () => {},
    stop: () => {},
    gameBreak: () => {},
    extension: () => {},
    timer: () => {},
    newGame: () => {},
    up: () => {},
    down: () => {},
    left: () => {},
    right: () => {},
  });
  const recordingFinishedResolverRef = useRef<((videoPath?: string) => void) | null>(null);
  const recordingFinishedPromiseRef = useRef<Promise<string | undefined> | null>(null);
  const shouldStartRecordingRef = useRef(false);
  const pendingYouTubeNativeStartRef = useRef<{
    url: string;
    options: {
      width: number;
      height: number;
      fps: number;
      bitrate: number;
      audioBitrate: number;
      sampleRate: number;
      isStereo: boolean;
      cameraFacing: 'front' | 'back';
      sourceType: 'phone' | 'webcam';
      rotationDegrees: number;
    };
  } | null>(null);
  const activeYouTubeBroadcastIdRef = useRef<string>('');
  const isEndingGameRef = useRef(false);
  const [isEndingGame, setIsEndingGame] = useState(false);
  const appliedReplayResumeSnapshotRef = useRef(false);
  const initializedGameStateRef = useRef(false);
  const initializedGameplayStateKeyRef = useRef('');
  const replayResumeSnapshotOnMount = getReplayResumeSnapshotSync();
  const replayReturnRequestOnMount = getReplayReturnRequestSync();
  const activeGameplaySessionOnMount = getActiveGameplaySessionSync();
  const reusableReplayResumeSnapshotOnMount =
    replayResumeSnapshotOnMount?.restoreOnNextFocus &&
    isReplayResumeSnapshotMatch(
      replayResumeSnapshotOnMount,
      undefined,
      undefined,
      currentAplusLiveMatchIdentity,
    )
      ? replayResumeSnapshotOnMount
      : null;
  const reusableActiveGameplaySessionOnMount =
    isActiveGameplaySessionReusable(
      activeGameplaySessionOnMount,
      currentAplusLiveMatchIdentity,
    )
      ? activeGameplaySessionOnMount
      : null;
  const routeGameplaySessionKey =
    String(routeParams.gameplaySessionKey || (gameSettings as any)?.gameplaySessionKey || '').trim();

  const initialMatchSessionId =
    reusableReplayResumeSnapshotOnMount?.matchSessionId ||
    replayReturnRequestOnMount?.matchSessionId ||
    reusableActiveGameplaySessionOnMount?.matchSessionId ||
    routeGameplaySessionKey ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const matchSessionIdRef = useRef(initialMatchSessionId);
  const currentGameplayStateKey =
    routeGameplaySessionKey || currentAplusLiveMatchIdentity || gameSettingsSignature || 'local-gameplay';
  const [isRecording, setIsRecording] = useState(false);
  const [poolBreakPlayerIndex, setPoolBreakPlayerIndex] = useState<number>(0);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [totalTurns, setTotalTurns] = useState(1);
  const [totalTime, setTotalTime] = useState(0);
  const [countdownTime, setCountdownTime] = useState<number>(0);
  const [warmUpCount, setWarmUpCount] = useState<number>();
  const [warmUpCountdownTime, setWarmUpCountdownTime] = useState<number>();
  const [playerSettings, setPlayerSettingsState] = useState<PlayerSettings>();
  const setPlayerSettings = useCallback(
    (
      value:
        | PlayerSettings
        | undefined
        | ((previous: PlayerSettings | undefined) => PlayerSettings | undefined),
    ) => {
      const optimisticNext =
        typeof value === 'function'
          ? (value as (
              previous: PlayerSettings | undefined,
            ) => PlayerSettings | undefined)(playerSettingsRef.current)
          : value;
      playerSettingsRef.current = cloneReplayValue(optimisticNext);

      setPlayerSettingsState(previous => {
        const next =
          typeof value === 'function'
            ? (value as (
                previous: PlayerSettings | undefined,
              ) => PlayerSettings | undefined)(previous)
            : value;
        playerSettingsRef.current = cloneReplayValue(next);
        return next;
      });
    },
    [],
  );
  const [winner, setWinner] = useState<Player>();
  const winnerAlertShownRef = useRef(false);
  const pendingNewGameAfterViolateRef = useRef(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [pool8FreeHole10Scores, setPool8FreeHole10Scores] = useState<number[]>([0, 0, 0, 0]);
  const [pool8FreeSetWinnerIndex, setPool8FreeSetWinnerIndex] = useState<number | null>(null);
  const [pool8Trackers, setPool8Trackers] = useState<Pool8Tracker[]>(buildDefaultPool8Trackers);
  const [pool8SetWinnerIndex, setPool8SetWinnerIndex] = useState<number | null>(null);
  const [cameraSessionNonce, setCameraSessionNonce] = useState(0);
  const replayReturnAtRef = useRef(0);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    totalTimeRef.current = totalTime;
  }, [totalTime]);

  useEffect(() => {
    totalTurnsRef.current = totalTurns;
  }, [totalTurns]);

  useEffect(() => {
    playerSettingsRef.current = cloneReplayValue(playerSettings);
  }, [playerSettings]);

  useEffect(() => {
    winnerRef.current = cloneReplayValue(winner);
  }, [winner]);

  useEffect(() => {
    if (!playerSettings) {
      return;
    }

    setPool8FreeHole10Scores(prev => {
      const next = Array.from({length: Math.max(4, playerSettings.playingPlayers.length)}, (_, index) => prev[index] || 0);
      return next;
    });
  }, [playerSettings?.playingPlayers.length]);


  const clearRecordingStartRetry = useCallback(() => {
    if (recordingStartRetryRef.current) {
      clearInterval(recordingStartRetryRef.current);
      recordingStartRetryRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (recordingRotateTimeoutRef.current) {
        clearTimeout(recordingRotateTimeoutRef.current);
      }
      clearRecordingStartRetry();
    };
  }, [clearRecordingStartRetry]);

  useEffect(() => {
    const unsubscribe = subscribeYouTubeNativeLiveState(event => {
      console.log('[YouTubeNativeLive]', event);
      if (event?.type === 'error' && event?.message) {
        if (
          event.message.includes('cameraId was null') ||
          event.message.includes('webcam USB') ||
          event.message.includes('Không tìm thấy camera')
        ) {
          pendingYouTubeNativeStartRef.current = null;
          shouldStartRecordingRef.current = false;
          pendingStartRecordingRef.current = false;
          setYoutubeLivePreparing(false);
          setYoutubeLivePreviewActive(false);
          setIsCameraReady(false);
          setIsStarted(false);
          setYouTubeNativeCameraLock(false);
          setYouTubeSourceLock(null);
        }
        setYoutubeLiveOverlay({
          visible: true,
          title: i18n.t('youtubeLiveErrorTitle'),
          message: event.message,
          checks: [],
        });
      }
    });

    return () => {
      unsubscribe();
      void stopYouTubeNativeLive();
    };
  }, [language]);



  const readYouTubeVisibilityFromStorage = useCallback(
    async (): Promise<Visibility> => {
      try {
        const raw = await AsyncStorage.getItem(LIVESTREAM_ACCOUNT_STORAGE_KEY);
        if (!raw) {
          return 'public';
        }

        const parsed = JSON.parse(raw) as StorageShape;
        const visibility = parsed?.youtube?.visibility;

        if (
          visibility === 'public' ||
          visibility === 'private' ||
          visibility === 'unlisted'
        ) {
          return visibility;
        }

        return 'public';
      } catch (_error) {
        return 'public';
      }
    },
    [],
  );

  const routeWebcamFolderName =
    gameSettings?.webcamFolderName != null
      ? String(gameSettings?.webcamFolderName)
      : undefined;
  const now =
    reusableReplayResumeSnapshotOnMount?.webcamFolderName ||
    replayReturnRequestOnMount?.webcamFolderName ||
    reusableActiveGameplaySessionOnMount?.webcamFolderName ||
    routeWebcamFolderName ||
    Date.now().toString();

  const [webcamFolderName, setWebcamFolderName] = useState<string>(String(now));

  useEffect(() => {
    let mounted = true;

    replayCompletedSegmentsRef.current = 0;
    currentReplaySegmentIndexRef.current = 0;
    currentReplaySegmentStartTotalTimeRef.current = 0;
    currentReplaySegmentWallStartMsRef.current = 0;
    replayTimelineSignatureRef.current = '';
    lastPruneCompletedSegmentsRef.current = 0;

    if (!webcamFolderName) {
      return () => {
        mounted = false;
      };
    }

    const restoredExistingMatchSession = Boolean(
      (reusableReplayResumeSnapshotOnMount?.matchSessionId &&
        reusableReplayResumeSnapshotOnMount.matchSessionId === matchSessionIdRef.current) ||
        (replayReturnRequestOnMount?.matchSessionId &&
          replayReturnRequestOnMount.matchSessionId === matchSessionIdRef.current) ||
        (reusableActiveGameplaySessionOnMount?.matchSessionId &&
          reusableActiveGameplaySessionOnMount.matchSessionId === matchSessionIdRef.current),
    );

    setActiveGameplaySessionSync({
      matchSessionId: matchSessionIdRef.current,
      webcamFolderName,
      savedAt: Date.now(),
      source: restoredExistingMatchSession ? 'restore-existing-session' : 'gameplay-active',
      aplusLiveMatchIdentity: currentAplusLiveMatchIdentity || undefined,
    });

    if (!activeMatchFolderNameRef.current) {
      activeMatchFolderNameRef.current = webcamFolderName;
      console.log('[MatchSession]', {
        event: restoredExistingMatchSession ? 'reuseMatchId' : 'createMatchId',
        activeMatchId: matchSessionIdRef.current,
        webcamFolderName,
        reasonIfCreateNew: restoredExistingMatchSession
          ? 'restored existing gameplay session; no new match id created'
          : 'initial gameplay session folder',
      });
    } else if (activeMatchFolderNameRef.current !== webcamFolderName) {
      console.log('[MatchSession]', {
        event: 'reuseMatchId',
        activeMatchId: matchSessionIdRef.current,
        webcamFolderName,
        previousWebcamFolderName: activeMatchFolderNameRef.current,
        reasonIfCreateNew: 'webcamFolderName state changed; existing recorder session remains guarded',
      });
      activeMatchFolderNameRef.current = webcamFolderName;
    } else {
      console.log('[MatchSession]', {
        event: 'reuseMatchId',
        activeMatchId: matchSessionIdRef.current,
        webcamFolderName,
      });
    }

    void (async () => {
      try {
        await cleanupBrokenReplayFiles(webcamFolderName);
        const existingFiles = await listReplayFiles(webcamFolderName);
        const nextSegmentIndex = await getNextReplaySegmentIndex(webcamFolderName);
        if (!mounted) {
          return;
        }

        replayCompletedSegmentsRef.current = nextSegmentIndex;
        currentReplaySegmentIndexRef.current = nextSegmentIndex;
      } catch (error) {
        console.log('[ReplayTimeline] load existing segments failed:', error);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [webcamFolderName]);


  const [isStarted, setIsStarted] = useState(
    gameSettings?.mode?.mode === 'fast' && selectedLivestreamPlatform !== 'youtube'
      ? true
      : false,
  );

  type YouTubeLiveOverlayState = {
    visible: boolean;
    title: string;
    message: string;
    checks: YouTubeEligibilityCheck[];
  };

  const [youtubeLiveOverlay, setYoutubeLiveOverlay] =
    useState<YouTubeLiveOverlayState | null>(null);
  const [youtubeLivePreviewActive, setYoutubeLivePreviewActive] =
    useState(false);
  const [youtubeLivePreparing, setYoutubeLivePreparing] = useState(false);
  const [youtubeNativeStartNonce, setYoutubeNativeStartNonce] = useState(0);
  const youtubeLiveNativeMode = youtubeLivePreviewActive || youtubeLivePreparing;

  useEffect(() => {
    setYouTubeNativeCameraLock(youtubeLiveNativeMode);

    if (!youtubeLiveNativeMode) {
      setYouTubeSourceLock(null);
    }

    return () => {
      setYouTubeNativeCameraLock(false);
      setYouTubeSourceLock(null);
    };
  }, [youtubeLiveNativeMode]);

  useEffect(() => {
    if (shouldUseYouTubeLive) {
      return;
    }

    pendingYouTubeNativeStartRef.current = null;
    setYoutubeLivePreparing(false);
    setYoutubeLivePreviewActive(false);
    setYouTubeNativeCameraLock(false);
    setYouTubeSourceLock(null);
  }, [shouldUseYouTubeLive]);

  useEffect(() => {
    if (!youtubeLiveNativeMode || !isCameraReady) {
      return;
    }

    const pending = pendingYouTubeNativeStartRef.current;
    if (!pending) {
      return;
    }

    pendingYouTubeNativeStartRef.current = null;

    let cancelled = false;
    const timer = setTimeout(() => {
      const startNativeLive = async () => {
        try {
          if (cancelled) {
            return;
          }

          console.log('[YouTube Live] native start requested');
          console.log('[YouTube Live] validating params', {
            hasUrl: Boolean(pending.url),
            hasStreamKey: Boolean(pending.url && pending.url.length > 24),
            cameraReady: isCameraReady,
            width: pending.options.width,
            height: pending.options.height,
            sourceType: pending.options.sourceType,
            cameraFacing: pending.options.cameraFacing,
          });
          await startYouTubeNativeLive(pending.url, pending.options);
        } catch (error: any) {
          console.log('[YouTube Live] native start failed:', error);
          const activeYouTubeBroadcastId = activeYouTubeBroadcastIdRef.current;
          activeYouTubeBroadcastIdRef.current = '';
          if (activeYouTubeBroadcastId) {
            try {
              await stopYouTubeLiveSession(activeYouTubeBroadcastId);
              console.log('[YouTube Live] stopped broadcast after native start failed:', activeYouTubeBroadcastId);
            } catch (youtubeStopError) {
              console.log('[YouTube Live] stop after native start failed:', youtubeStopError);
            }
          }
          pendingYouTubeNativeStartRef.current = null;
          setYoutubeLivePreparing(false);
          setYoutubeLivePreviewActive(false);
          setIsCameraReady(false);
          setIsStarted(false);
          setYouTubeNativeCameraLock(false);
          setYouTubeSourceLock(null);
          setYoutubeLiveOverlay({
            visible: true,
            title: i18n.t('youtubeLiveErrorTitle'),
            message: error?.message || i18n.t('youtubeLiveCannotStart'),
            checks: [],
          });
        }
      };

      void startNativeLive();
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isCameraReady, youtubeLiveNativeMode, youtubeNativeStartNonce]);

  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isMatchPaused, setIsMatchPaused] = useState<boolean>(false);
  const [gameBreakEnabled, setGameBreakEnabled] = useState<boolean>(false);
  const [poolBreakEnabled, setPoolBreakEnabled] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [proModeEnabled, setProModeEnabled] = useState(
  !isPoolGame(gameSettings?.category) && gameSettings?.mode?.mode !== 'fast' &&
      gameSettings?.mode?.mode !== 'quick_match',
);

  const applyReplayResumeSnapshot = useCallback((snapshot: ReplayResumeSnapshot) => {
    clearInterval(countdownInterval);
    clearInterval(warmUpCountdownInterval);

    const scoreBeforeReplayRestore = getScoreSnapshotFromPlayerSettings(playerSettingsRef.current);
    playerSettingsRef.current = cloneReplayValue(snapshot.playerSettings);
    winnerRef.current = cloneReplayValue(snapshot.winner);

    console.log('[ReplayReturnFlow]', {
      event: 'closeReplay',
      scoreBeforeReplay: getScoreSnapshotFromPlayerSettings(snapshot.playerSettings),
      scoreAfterReplayClose: getScoreSnapshotFromPlayerSettings(snapshot.playerSettings),
      scoreBeforeRestore: scoreBeforeReplayRestore,
      matchIdBeforeReplay: snapshot.matchSessionId,
      matchIdAfterReplayClose: snapshot.matchSessionId,
      historyPathBeforeReplay: lastRecordedVideoPathRef.current,
      historyPathAfterReplayClose: lastRecordedVideoPathRef.current,
      replayCleanupTouchedHistory: false,
      replayCleanupTouchedScore: false,
    });

    setWebcamFolderName(snapshot.webcamFolderName || Date.now().toString());
    setCurrentPlayerIndex(snapshot.currentPlayerIndex ?? 0);
    setPoolBreakPlayerIndex(snapshot.poolBreakPlayerIndex ?? 0);
    setTotalTurns(snapshot.totalTurns ?? 1);
    setTotalTime(snapshot.totalTime ?? 0);
    setCountdownTime(snapshot.countdownTime ?? 0);
    setWarmUpCount(snapshot.warmUpCount);
    setWarmUpCountdownTime(snapshot.warmUpCountdownTime);
    setPlayerSettings(cloneReplayValue(snapshot.playerSettings));
    setWinner(cloneReplayValue(snapshot.winner));
    setIsStarted(!!snapshot.isStarted);
    setIsPaused(!!snapshot.isPaused);
    setIsMatchPaused(!!snapshot.isMatchPaused);
    setGameBreakEnabled(!!snapshot.gameBreakEnabled);
    setPoolBreakEnabled(!!snapshot.poolBreakEnabled);
    setSoundEnabled(
      snapshot.soundEnabled == null ? true : !!snapshot.soundEnabled,
    );
    setProModeEnabled(!!snapshot.proModeEnabled);

    if (snapshot.matchSessionId) {
      matchSessionIdRef.current = snapshot.matchSessionId;
    }

    setActiveGameplaySessionSync({
      matchSessionId: snapshot.matchSessionId || matchSessionIdRef.current,
      webcamFolderName: snapshot.webcamFolderName || webcamFolderName,
      savedAt: Date.now(),
      source: 'replay-restore',
      aplusLiveMatchIdentity: snapshot.aplusLiveMatchIdentity || currentAplusLiveMatchIdentity || undefined,
    });

    appliedReplayResumeSnapshotRef.current = true;
    initializedGameStateRef.current = true;
    initializedGameplayStateKeyRef.current =
      snapshot.aplusLiveMatchIdentity || currentGameplayStateKey;
  }, [currentAplusLiveMatchIdentity, currentGameplayStateKey, webcamFolderName]);

  const tryRestoreReplayResumeSnapshot = useCallback(async () => {
    const snapshot = await getReplayResumeSnapshot();
    const returnRequest = getReplayReturnRequestSync();
    const expectedFolderName = webcamFolderName || gameSettings?.webcamFolderName;
    const expectedMatchSessionId =
      returnRequest?.matchSessionId || matchSessionIdRef.current;

    const shouldRestoreBecausePlaybackIsReturning = Boolean(
      snapshot?.restoreOnNextFocus && isReplayResumeSnapshotReusable(snapshot),
    );
    const shouldForceRestore = Boolean(
      shouldRestoreBecausePlaybackIsReturning ||
        (returnRequest &&
          snapshot &&
          isReplayResumeSnapshotReusable(snapshot) &&
          ((returnRequest.matchSessionId &&
            snapshot.matchSessionId === returnRequest.matchSessionId) ||
            (returnRequest.webcamFolderName &&
              snapshot.webcamFolderName === returnRequest.webcamFolderName))),
    );

    if (!shouldForceRestore && !snapshot?.restoreOnNextFocus) {
      return false;
    }

    if (
      !shouldForceRestore &&
      !isReplayResumeSnapshotMatch(
        snapshot,
        expectedFolderName,
        expectedMatchSessionId,
        currentAplusLiveMatchIdentity,
      )
    ) {
      return false;
    }

    // Kể cả luồng replay return có yêu cầu restore, không bao giờ cho snapshot
    // của trận Aplus khác ghi đè vào trận đang mở. Đây là chốt chống lỗi T6
    // bị lấy lại điểm/timer của T3.
    if (currentAplusLiveMatchIdentity) {
      if (snapshot?.aplusLiveMatchIdentity !== currentAplusLiveMatchIdentity) {
        return false;
      }
    } else if (snapshot?.aplusLiveMatchIdentity) {
      return false;
    }

    console.log(
      '[Replay] Khôi phục trận đang tạm dừng:',
      snapshot?.matchSessionId,
      snapshot?.webcamFolderName,
    );

    applyReplayResumeSnapshot(snapshot!);
    setReplayReturnRequestSync(null);

    // Force camera preview remount after coming back from replay.
    // This avoids a stale surface/player instance causing jittery preview.
    setIsCameraReady(false);
    replayReturnAtRef.current = Date.now();
    setCameraSessionNonce(value => value + 1);

    // Giữ lại snapshot nhưng tắt auto-restore để tránh focus lại là ghi đè state lần nữa.
    await setReplayResumeSnapshot({
      ...snapshot!,
      aplusLiveMatchIdentity: snapshot?.aplusLiveMatchIdentity || currentAplusLiveMatchIdentity || undefined,
      restoreOnNextFocus: false,
    });

    return true;
  }, [
    applyReplayResumeSnapshot,
    gameSettings?.webcamFolderName,
    webcamFolderName,
    currentAplusLiveMatchIdentity,
  ]);

  const buildLiveMatchSnapshot = useCallback((): LiveMatchSnapshot | null => {
    if (!playerSettings || !gameSettingsSignature) {
      return null;
    }

    return {
      matchSessionId: matchSessionIdRef.current,
      webcamFolderName,
      currentPlayerIndex,
      poolBreakPlayerIndex,
      totalTurns,
      totalTime,
      countdownTime,
      warmUpCount,
      warmUpCountdownTime,
      playerSettings: cloneReplayValue(playerSettings),
      winner: cloneReplayValue(winner),
      isStarted,
      isPaused,
      isMatchPaused,
      gameBreakEnabled,
      poolBreakEnabled,
      soundEnabled,
      proModeEnabled,
      savedAt: Date.now(),
      configSignature: gameSettingsSignature,
      aplusLiveMatchIdentity: currentAplusLiveMatchIdentity || undefined,
    };
  }, [
    countdownTime,
    currentPlayerIndex,
    gameBreakEnabled,
    gameSettingsSignature,
    currentAplusLiveMatchIdentity,
    isMatchPaused,
    isPaused,
    isStarted,
    playerSettings,
    poolBreakEnabled,
    poolBreakPlayerIndex,
    proModeEnabled,
    soundEnabled,
    totalTime,
    totalTurns,
    warmUpCount,
    warmUpCountdownTime,
    webcamFolderName,
    winner,
  ]);

  const tryRestoreLiveMatchSnapshot = useCallback(async () => {
    const snapshot = await getLiveMatchSnapshot();

    if (
      !isLiveMatchSnapshotUsable(
        snapshot,
        gameSettingsSignature,
        currentAplusLiveMatchIdentity,
      )
    ) {
      return false;
    }

    debugMatchRestoreLog(
      '[Live Match] Restoring active match snapshot:',
      snapshot?.matchSessionId,
      snapshot?.webcamFolderName,
    );

    applyReplayResumeSnapshot(snapshot!);

    const shouldResumeRecording = !!(
      snapshot?.isStarted &&
      !snapshot?.isPaused &&
      !youtubeLiveNativeMode
    );

    shouldStartRecordingRef.current = shouldResumeRecording;
    pendingStartRecordingRef.current = shouldResumeRecording;

    return true;
  }, [
    applyReplayResumeSnapshot,
    gameSettingsSignature,
    youtubeLiveNativeMode,
    currentAplusLiveMatchIdentity,
  ]);

  useEffect(() => {
    // Không cho build mới / mở app mới tự restore trận cũ từ storage.
    // Luồng "Xem lại -> Quay lại" vẫn dùng replay snapshot riêng.
    void clearPersistedLiveMatchSnapshot();
  }, []);

  useFocusEffect(
    useCallback(() => {
      const restoreSnapshotsOnFocus = async () => {
        const restoredFromReplay = await tryRestoreReplayResumeSnapshot();

        if (!restoredFromReplay) {
          await tryRestoreLiveMatchSnapshot();
        }
      };

      void restoreSnapshotsOnFocus();

      return () => {};
    }, [tryRestoreLiveMatchSnapshot, tryRestoreReplayResumeSnapshot]),
  );


  useEffect(() => {
    const snapshot = buildLiveMatchSnapshot();

    if (!snapshot) {
      return;
    }

    const leftPlayer = snapshot.playerSettings?.playingPlayers?.[0];
    const rightPlayer = snapshot.playerSettings?.playingPlayers?.[1];
    const signature = JSON.stringify({
      webcamFolderName: snapshot.webcamFolderName,
      currentPlayerIndex: snapshot.currentPlayerIndex,
      poolBreakPlayerIndex: snapshot.poolBreakPlayerIndex,
      totalTurns: snapshot.totalTurns,
      totalTimeBucket: Math.floor(Number(snapshot.totalTime || 0) / 5),
      countdownBucket: Math.floor(Number(snapshot.countdownTime || 0) / 5),
      warmUpBucket:
        snapshot.warmUpCountdownTime == null
          ? null
          : Math.floor(Number(snapshot.warmUpCountdownTime) / 5),
      leftScore: Number(leftPlayer?.totalPoint ?? 0),
      rightScore: Number(rightPlayer?.totalPoint ?? 0),
      leftCurrentPoint: Number(leftPlayer?.proMode?.currentPoint ?? 0),
      rightCurrentPoint: Number(rightPlayer?.proMode?.currentPoint ?? 0),
      winnerName: snapshot.winner?.name ?? null,
      isStarted: snapshot.isStarted,
      isPaused: snapshot.isPaused,
      isMatchPaused: snapshot.isMatchPaused,
      gameBreakEnabled: snapshot.gameBreakEnabled,
      poolBreakEnabled: snapshot.poolBreakEnabled,
      soundEnabled: snapshot.soundEnabled,
      proModeEnabled: snapshot.proModeEnabled,
    });

    const now = Date.now();
    if (
      signature === lastLiveSnapshotSignatureRef.current &&
      now - lastLiveSnapshotSyncAtRef.current < LIVE_SNAPSHOT_SYNC_MIN_MS
    ) {
      return;
    }

    lastLiveSnapshotSignatureRef.current = signature;
    lastLiveSnapshotSyncAtRef.current = now;
    setLiveMatchSnapshotSync(snapshot);

    if (Platform.OS === 'windows' && selectedLivestreamPlatform === 'youtube') {
      void updateWindowsFfmpegOverlay(
        createWindowsFfmpegSnapshotFromGameState({
          gameSettings,
          playerSettings: snapshot.playerSettings,
          currentPlayerIndex: snapshot.currentPlayerIndex,
          countdownTime: snapshot.countdownTime,
          totalTurns: snapshot.totalTurns,
        }),
      );
    }
  }, [buildLiveMatchSnapshot, gameSettings, selectedLivestreamPlatform]);

  // useEffect(() => {
  //      if(!hasPermission){
  //        requestPermission()
  //      }
  // }, [hasPermission]);

  useEffect(() => {
    const isCaromRemoteTurnMode = isCaromGame(gameSettings?.category);

    // Pool: NEW GAME still requires 3s hold before reset.
    // Carom: NEW GAME is reused as "tăng lượt", so it fires immediately.
    RemoteControl.instance.setNewGameHoldRequired?.(!isCaromRemoteTurnMode);

    const isQuickMatchRemoteMode = gameSettings?.mode?.mode === 'quick_match';
    const quickMatchWarmUpActive =
      isQuickMatchRemoteMode &&
      !isStarted &&
      ((typeof warmUpCountdownTime === 'number' && warmUpCountdownTime >= 0) ||
        Number(warmUpCount || 0) > 0);

    const handleQuickMatchPrimaryRemoteAction = () => {
      if (quickMatchWarmUpActive) {
        onWarmUp();
        return;
      }

      if (isStarted) {
        onPause();
        return;
      }

      void onStart();
    };

    remoteHandlersRef.current = {
      start: () => {
        console.log('[Remote][Start] toggle v13-quick-match-two-state', {
          isStarted,
          isPaused,
          isMatchPaused,
          isQuickMatchRemoteMode,
          quickMatchWarmUpActive,
        });

        if (isQuickMatchRemoteMode) {
          handleQuickMatchPrimaryRemoteAction();
          return;
        }

        if (quickMatchWarmUpActive) {
          onWarmUp();
          return;
        }

        if (isStarted) {
          onPause();
          return;
        }

        void onStart();
      },
      warmUp: isQuickMatchRemoteMode
        ? handleQuickMatchPrimaryRemoteAction
        : quickMatchWarmUpActive
          ? onWarmUp
          : warmUpCountdownTime
            ? onEndWarmUp
            : onWarmUp,
      stop: isQuickMatchRemoteMode
        ? () => {
            console.log('[Remote][QuickMatch] STOP -> end match');
            quickMatchRemoteStopRef.current?.();
          }
        : onToggleCountDown,
      gameBreak: isQuickMatchRemoteMode
        ? () => {
            console.log('[Remote][QuickMatch] BREAK ignored: quick match has no Break/New game button');
          }
        : isCaromRemoteTurnMode
          ? () => {
              console.log('[Remote][Carom] BREAK -> decrease turns');
              setTotalTurns(prev => Math.max(1, (Number(prev) || 1) - 1));
            }
          : onPoolBreak,
      extension: isQuickMatchRemoteMode
        ? () => {
            console.log('[Remote][QuickMatch] EXTENSION ignored');
          }
        : onPressGiveMoreTime,
      timer: isQuickMatchRemoteMode
        ? () => {
            console.log('[Remote][QuickMatch] TIMER ignored');
          }
        : isCaromRemoteTurnMode
          ? () => {
              console.log('[Remote][Carom] TIMER ignored');
            }
          : onResetTurn,
      newGame: isQuickMatchRemoteMode
        ? () => {
            console.log('[Remote][QuickMatch] NEW_GAME ignored: quick match has no Break/New game button');
          }
        : isCaromRemoteTurnMode
          ? () => {
              console.log('[Remote][Carom] NEW_GAME -> increase turns');
              setTotalTurns(prev => Math.max(1, (Number(prev) || 0) + 1));
            }
          : onReset,
      up: () => onChangePlayerPoint(1, currentPlayerIndex, 0),
      down: () => onChangePlayerPoint(-1, currentPlayerIndex, 0),
      left: onEndTurn,
      right: onEndTurn,
    };
  }, [
    gameSettings?.category,
    gameSettings?.mode?.mode,
    isStarted,
    isEndingGame,
    isPaused,
    isMatchPaused,
    poolBreakEnabled,
    warmUpCount,
    warmUpCountdownTime,
    onPause,
    onStart,
    onEndWarmUp,
    onWarmUp,
    onQuickMatchWarmUpNext,
    onToggleCountDown,
    onPoolBreak,
    onPressGiveMoreTime,
    onResetTurn,
    onReset,
    onChangePlayerPoint,
    currentPlayerIndex,
    onEndTurn,
  ]);

  useEffect(() => {
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.START,
      () => remoteHandlersRef.current.start(),
    );
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.WARM_UP,
      () => remoteHandlersRef.current.warmUp(),
    );
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.STOP,
      () => remoteHandlersRef.current.stop(),
    );
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.BREAK,
      () => remoteHandlersRef.current.gameBreak(),
    );
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.EXTENSION,
      () => remoteHandlersRef.current.extension(),
    );
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.TIMER,
      () => remoteHandlersRef.current.timer(),
    );
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.NEW_GAME,
      () => remoteHandlersRef.current.newGame(),
    );
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.UP,
      () => remoteHandlersRef.current.up(),
    );
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.DOWN,
      () => remoteHandlersRef.current.down(),
    );
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.LEFT,
      () => remoteHandlersRef.current.left(),
    );
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.RIGHT,
      () => remoteHandlersRef.current.right(),
    );
  }, []);
  useEffect(() => {
    clearInterval(countdownInterval);
    clearInterval(warmUpCountdownInterval);

    if (!gameSettings) {
      return;
    }

    let cancelled = false;

    const initializeGameState = async () => {
      const alreadyInitializedForCurrentGame =
        initializedGameStateRef.current &&
        initializedGameplayStateKeyRef.current === currentGameplayStateKey;

      if (cancelled || alreadyInitializedForCurrentGame) {
        return;
      }

      const isSwitchingToDifferentGame = Boolean(
        initializedGameplayStateKeyRef.current &&
          initializedGameplayStateKeyRef.current !== currentGameplayStateKey,
      );

      if (isSwitchingToDifferentGame) {
        clearInterval(countdownInterval);
        clearInterval(warmUpCountdownInterval);
        setReplayResumeSnapshotSync(null);
        setReplayReturnRequestSync(null);
        setLiveMatchSnapshotSync(null);
        clearActiveGameplaySessionSync();
        aplusLiveScoreLastSignatureRef.current = '';
        aplusLiveScoreLastPushAtRef.current = 0;
        matchSessionIdRef.current =
          routeGameplaySessionKey ||
          `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        activeMatchFolderNameRef.current = null;
        setWebcamFolderName(Date.now().toString());
      }

      const restoredFromReplay = await tryRestoreReplayResumeSnapshot();
      if (cancelled || restoredFromReplay) {
        return;
      }

      const restoredFromLive = await tryRestoreLiveMatchSnapshot();
      if (cancelled || restoredFromLive) {
        return;
      }

      appliedReplayResumeSnapshotRef.current = false;
      initializedGameStateRef.current = true;
      initializedGameplayStateKeyRef.current = currentGameplayStateKey;

      setIsStarted(false);
      setIsPaused(false);
      setIsMatchPaused(false);
      setGameBreakEnabled(false);
      setWinner(undefined);
    setPool8FreeSetWinnerIndex(null);
      setTotalTurns(1);
      setTotalTime(0);
      setCurrentPlayerIndex(0);
      setPoolBreakPlayerIndex(0);

      setPlayerSettings(cloneReplayValue(gameSettings?.players));

      if (gameSettings?.mode?.warmUpTime) {
        setWarmUpCount(gameSettings.players.playingPlayers.length);
      } else {
        setWarmUpCount(undefined);
        setWarmUpCountdownTime(undefined);
      }

      if (gameSettings?.mode?.countdownTime) {
        setCountdownTime(gameSettings.mode?.countdownTime);
      } else {
        setCountdownTime(0);
      }

      if (gameSettings?.mode?.mode === 'fast') {
        setCountdownTime(gameSettings?.mode?.countdownTime || 0);
      }

      if (
        isPoolGame(gameSettings?.category) &&
        !isPool15FreeGame(gameSettings?.category) &&
        gameSettings?.mode?.countdownTime
      ) {
        setPoolBreakEnabled(true);
      }

      if (isPool15OnlyGame(gameSettings?.category)) {
        setPool8Trackers(buildDefaultPool8Trackers());
        setPool8SetWinnerIndex(null);
      }
    };

    void initializeGameState();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gameSettings,
    tryRestoreLiveMatchSnapshot,
    tryRestoreReplayResumeSnapshot,
    currentGameplayStateKey,
    routeGameplaySessionKey,
  ]);

  useEffect(() => {
    if (!isStarted || isPaused || !isCameraReady) {
      clearRecordingStartRetry();
      return;
    }

    if (!shouldStartRecordingRef.current && !pendingStartRecordingRef.current) {
      return;
    }

    if (isRecordingRef.current || isStoppingRecordingRef.current) {
      return;
    }

    if (recordingStartRetryRef.current) {
      return;
    }

    const replayReturnAge = Date.now() - replayReturnAtRef.current;
    const startDelay =
      replayReturnAge >= 0 && replayReturnAge < 4000
        ? REPLAY_RETURN_CAMERA_STABILIZE_MS
        : 0;

    console.log('[Replay] auto start recording after camera ready', {startDelay});

    let attempts = 0;
    const beginRetryLoop = () => {
      recordingStartRetryRef.current = setInterval(() => {
      attempts += 1;
      console.log('[Replay] start retry attempt:', attempts);

      const started = startVideoRecording();

      if (started) {
        shouldStartRecordingRef.current = false;
        pendingStartRecordingRef.current = false;
        clearRecordingStartRetry();
        return;
      }

        if (attempts >= 12) {
          console.log('[Replay] failed to start recording after retries');
          shouldStartRecordingRef.current = false;
          pendingStartRecordingRef.current = false;
          clearRecordingStartRetry();
        }
      }, 500);
    };

    const startDelayTimer = setTimeout(beginRetryLoop, startDelay);

    return () => {
      clearTimeout(startDelayTimer);
      clearRecordingStartRetry();
    };
  }, [
    isStarted,
    isPaused,
    isCameraReady,
    isRecording,
    clearRecordingStartRetry,
    webcamFolderName,
    youtubeLivePreviewActive,
  ]);

  useEffect(() => {
    if (!webcamFolderName || !isStarted || isPaused || !playerSettings) {
      return;
    }

    if (
      !isPool9Game(gameSettings?.category) &&
      !isPool10Game(gameSettings?.category) &&
      !isCaromGame(gameSettings?.category)
    ) {
      return;
    }

    const leftPlayer = playerSettings?.playingPlayers?.[0];
    const rightPlayer = playerSettings?.playingPlayers?.[1];
    const goal = Number(
      gameSettings?.players?.goal?.goal ?? playerSettings?.goal?.goal ?? 0,
    );
    const baseCountdown = Number(gameSettings?.mode?.countdownTime ?? 0);
    const segmentIndex = currentReplaySegmentIndexRef.current;
    const segmentTime = Math.max(
      0,
      totalTime - currentReplaySegmentStartTotalTimeRef.current,
    );
    const segmentTimeBucket = Math.floor(segmentTime / REPLAY_TIMELINE_TIME_BUCKET_SECONDS);
    const countdownBucket = Math.floor(Number(countdownTime || 0) / REPLAY_TIMELINE_COUNTDOWN_BUCKET_SECONDS);

    const signature = JSON.stringify({
      webcamFolderName,
      segmentIndex,
      segmentTimeBucket,
      countdownBucket,
      currentPlayerIndex,
      goal,
      baseCountdown,
      gameMode: gameSettings?.mode?.mode,
      leftScore: Number(leftPlayer?.totalPoint ?? 0),
      rightScore: Number(rightPlayer?.totalPoint ?? 0),
      totalTurns: Number(totalTurns || 1),
      leftCurrentPoint: Number(leftPlayer?.proMode?.currentPoint ?? 0),
      rightCurrentPoint: Number(rightPlayer?.proMode?.currentPoint ?? 0),
    });

    if (signature === lastReplayTimelineWriteSignatureRef.current) {
      return;
    }

    lastReplayTimelineWriteSignatureRef.current = signature;
    replayTimelineSignatureRef.current = signature;

    void appendReplayScoreboardTimelineEntry(webcamFolderName, {
      segmentIndex,
      segmentTime,
      currentPlayerIndex,
      countdownTime,
      baseCountdown,
      category: gameSettings?.category,
      gameMode: gameSettings?.mode?.mode,
      goal,
      playerSettings: cloneReplayValue(playerSettings),
      totalTurns: Number(totalTurns || 1),
      savedAt: Date.now(),
    });
  }, [
    webcamFolderName,
    isStarted,
    isPaused,
    playerSettings,
    gameSettings?.category,
    gameSettings?.players?.goal?.goal,
    gameSettings?.mode?.mode,
    gameSettings?.mode?.countdownTime,
    totalTime,
    currentPlayerIndex,
    countdownTime,
    totalTurns,
  ]);

  useEffect(() => {
    if (!isStarted || isPaused) {
      return;
    }

    countdownInterval = setInterval(() => {
      setTotalTime(prev => prev + 1);

      if (!isMatchPaused && !poolBreakEnabled) {
        setCountdownTime(prev =>
          typeof prev === 'number' && prev > 0 ? prev - 1 : 0,
        );
      }
    }, 1000);

    return () => {
      clearInterval(countdownInterval);
    };
  }, [isStarted, isPaused, isMatchPaused, poolBreakEnabled]);

  useEffect(() => {
    if (typeof warmUpCountdownTime !== 'number') {
      return;
    }

    warmUpCountdownInterval = setInterval(() => {
      setWarmUpCountdownTime(prev => {
        if (typeof prev !== 'number') {
          return prev;
        }

        if (gameBreakEnabled) {
          return prev + 1;
        }

        return prev > 0 ? prev - 1 : 0;
      });
    }, 1000);

    return () => {
      clearInterval(warmUpCountdownInterval);
    };
  }, [typeof warmUpCountdownTime === 'number', gameBreakEnabled]);

  useEffect(() => {
    if (!isStarted || !soundEnabled || !gameSettings?.mode?.countdownTime) {
      return;
    }

    if (countdownTime > 0 && countdownTime <= 10) {
      playCountdownBeepSafely();
    }
  }, [isStarted, soundEnabled, countdownTime, gameSettings]);

  // useEffect(() => {
  //   if (!matchCountdownRef.current || isCaromGame(gameSettings?.category)) {
  //     return;
  //   }

  //   captureRef(matchCountdownRef, {
  //     format: 'png',
  //     quality: 0.01,
  //     width: 1242,
  //   })
  //     .then(
  //       async uri => {
  //         const matchCountdownImagePath = `${RNFS.DownloadDirectoryPath}/${WEBCAM_BASE_CAMERA_FOLDER}/${MATCH_COUNTDOWN}`;

  //         console.log("matchCountdownImagePath" + matchCountdownImagePath)

  //         const _path = uri.slice(7);
  //         console.log("prh" + _path)

  //         RNFS.copyFile(_path, matchCountdownImagePath);
  //       },
  //       error => console.log('Oops, match countdown failed', error),
  //     )
  //     .catch(e => {
  //       if (__DEV__) {
  //         console.log('Capture countdown error', e);
  //       }
  //     });
  // }, [countdownTime, gameSettings]);

  // useEffect(() => {
  //   return () => {
  //     cancelStreamWebcamToFile();
  //   };
  // }, []);

  const updateWebcamFolderName = useCallback((name: string) => {
    setWebcamFolderName(name);
  }, []);

  const _resetCountdown = useCallback(
    (isResume?: boolean, cumulativeTime?: boolean) => {
      if (!gameSettings || !gameSettings.mode?.countdownTime) {
        return;
      }

      if (cumulativeTime) {
        setCountdownTime(countdownTime + gameSettings!.mode?.countdownTime);
      } else if (!isResume) {
        setCountdownTime(gameSettings!.mode?.countdownTime);
      }
    },
    [gameSettings, countdownTime],
  );

  const onEditPlayerName = useCallback((index: number, newName: string) => {
    setPlayerSettings(
      prev =>
        ({
          ...prev,
          playingPlayers: prev?.playingPlayers.map((player, playerIndex) => {
            if (index === playerIndex) {
              return {...player, name: newName};
            }

            return player;
          }),
        } as PlayerSettings),
    );
  }, []);

  const navigateBackAfterWinner = useCallback(() => {
    setTimeout(() => {
      try {
        if (navigation?.canGoBack?.()) {
          navigation.goBack();
          return;
        }
      } catch (error) {
        console.log('[WinnerAlert] navigation.goBack failed', error);
      }

      try {
        goBack();
      } catch (error) {
        console.log('[WinnerAlert] fallback goBack failed', error);
      }
    }, 0);
  }, [navigation]);

  const showWinnerAlertAndGoBack = useCallback((winnerPlayer?: Player) => {
    if (!winnerPlayer?.name || winnerAlertShownRef.current) {
      return;
    }

    const shouldUseCaromWinnerSummary =
      isCaromGame(gameSettings?.category) &&
      gameSettings?.mode?.mode === 'pro' &&
      (playerSettings?.playingPlayers?.length || 0) === 2;

    if (shouldUseCaromWinnerSummary) {
      return;
    }

    winnerAlertShownRef.current = true;

    Alert.alert(
      i18n.t('txtWin'),
      i18n.t('msgWinner', {player: winnerPlayer.name}),
      [
        {
          text: i18n.t('txtClose'),
          onPress: () => {
            winnerAlertShownRef.current = false;
            navigateBackAfterWinner();
          },
        },
      ],
      {cancelable: false},
    );
  }, [gameSettings?.category, gameSettings?.mode?.mode, navigateBackAfterWinner, playerSettings?.playingPlayers?.length]);

  const resetCurrentMatchForNextGame = useCallback(() => {
    pendingNewGameAfterViolateRef.current = false;
    winnerAlertShownRef.current = false;
    void setReplayResumeSnapshot(null);
    void setLiveMatchSnapshot(null);
    setReplayReturnRequestSync(null);
    setWinner(undefined);
    setIsStarted(false);
    setIsPaused(false);
    setIsMatchPaused(false);
    setGameBreakEnabled(false);
    setWarmUpCountdownTime(undefined);
    clearInterval(warmUpCountdownInterval);
    setTotalTurns(1);
    setTotalTime(0);
    setCurrentPlayerIndex(0);
    setPoolBreakPlayerIndex(0);
    setPool8SetWinnerIndex(null);
    setPool8FreeSetWinnerIndex(null);

    if (gameSettings?.mode?.warmUpTime) {
      setWarmUpCount(gameSettings.players.playingPlayers.length);
    } else {
      setWarmUpCount(undefined);
    }

    if (gameSettings?.mode?.countdownTime) {
      const extraTimeBonus = isPoolGame(gameSettings?.category)
        ? gameSettings.mode?.extraTimeBonus || 0
        : 0;
      setCountdownTime(gameSettings.mode.countdownTime + extraTimeBonus);
    } else {
      setCountdownTime(0);
    }

    const sourcePlayerSettings = playerSettings || gameSettings?.players;

    if (sourcePlayerSettings) {
      setPlayerSettings({
        ...sourcePlayerSettings,
        playingPlayers: sourcePlayerSettings.playingPlayers.map(player => ({
          ...player,
          totalPoint: 0,
          violate: 0,
          scoredBalls: [],
          proMode: player.proMode
            ? {
                ...player.proMode,
                highestRate: 0,
                secondHighestRate: 0,
                average: 0,
                currentPoint: 0,
                extraTimeTurns: gameSettings?.mode?.extraTimeTurns,
              }
            : player.proMode,
        })),
      } as PlayerSettings);
    }
  }, [gameSettings, playerSettings]);

  const onCloseWinnerSummary = useCallback(() => {
    resetCurrentMatchForNextGame();
    navigateBackAfterWinner();
  }, [navigateBackAfterWinner, resetCurrentMatchForNextGame]);

  const onChangePlayerPoint = useCallback(
    (addedPoint: number, index: number, stepIndex: number) => {
      if (
        !isStarted ||
        stepIndex === 4 ||
        !playerSettings ||
        !gameSettings ||
        winner
      ) {
        return;
      }

      const player = playerSettings.playingPlayers[index];
      if (!player) {
        return;
      }

      const targetGoal = getTargetGoalValue(gameSettings);
      const currentTotalPoint = Number(player.totalPoint || 0);
      const actualAddedPoint = clampScoreDeltaToGoal(
        currentTotalPoint,
        Number(addedPoint || 0),
        targetGoal,
      );

      // v13: chạm điểm mục tiêu thì chặn tăng thêm, nhưng vẫn cho giảm điểm.
      // Không tự hiện thắng ở đây; chỉ bấm Kết thúc mới chốt người thắng.
      if (actualAddedPoint === 0) {
        console.log('[TargetScoreLimit] blocked point change v13', {
          index,
          currentTotalPoint,
          requestedDelta: addedPoint,
          targetGoal,
        });
        return;
      }

      setPlayerSettings(
        prev =>
          ({
            ...prev,
            playingPlayers: prev?.playingPlayers.map((currentPlayer, playerIndex) => {
              if (index === playerIndex) {
                const updatedTotalPoint = Math.max(
                  0,
                  Number(currentPlayer.totalPoint || 0) + actualAddedPoint,
                );
                const updatedCurrentPoint = Math.max(
                  0,
                  Number(currentPlayer.proMode?.currentPoint || 0) + actualAddedPoint,
                );
                const updatedAverage = Number(
                  (updatedTotalPoint / Math.max(1, totalTurns + 1)).toFixed(2),
                );

                return {
                  ...currentPlayer,
                  totalPoint: updatedTotalPoint,
                  proMode: currentPlayer.proMode
                    ? {
                        ...currentPlayer.proMode,
                        // v15: Không ghi High Run khi đang cộng từng điểm trong cùng 1 lượt.
                        // HR1/HR2 hiển thị live sẽ được tính từ currentPoint ở PlayerViewModel,
                        // còn HR thật chỉ được chốt khi đổi lượt hoặc kết thúc trận.
                        average: updatedAverage,
                        currentPoint: updatedCurrentPoint,
                      }
                    : currentPlayer.proMode,
                };
              }

              return currentPlayer;
            }),
          } as PlayerSettings),
      );

      if (!isPoolGame(gameSettings.category)) {
        _resetCountdown();
        setIsMatchPaused(false);
      }
    },
    [
      isStarted,
      gameSettings,
      playerSettings,
      winner,
      _resetCountdown,
      totalTurns,
    ],
  );

  useEffect(() => {
    quickMatchRemoteStopRef.current = onStop;
  }, [onStop]);

  const onPressGiveMoreTime = useCallback(() => {
    const baseCountdown = Number(gameSettings?.mode?.countdownTime || 0);
    const configuredBonus = Number(gameSettings?.mode?.extraTimeBonus || 0);
    const currentSettings = playerSettingsRef.current ?? playerSettings;
    const currentPlayer = currentSettings?.playingPlayers?.[currentPlayerIndex];
    const settingExtraTimeTurns = gameSettings?.mode?.extraTimeTurns;
    const configuredExtraTimeTurns = Number(settingExtraTimeTurns);
    const isUnlimitedExtraTimeTurns = settingExtraTimeTurns === 'infinity';
    const playerRemainingTurns = currentPlayer?.proMode?.extraTimeTurns;
    const remainingTurns =
      typeof playerRemainingTurns === 'number'
        ? playerRemainingTurns
        : Number.isFinite(configuredExtraTimeTurns)
          ? configuredExtraTimeTurns
          : playerRemainingTurns;
    const hasLimitedExtraTimeTurns =
      !isUnlimitedExtraTimeTurns &&
      (typeof remainingTurns === 'number' || Number.isFinite(configuredExtraTimeTurns));

    console.log('[Extension] press v12-limit-fix', {
      isStarted,
      baseCountdown,
      configuredBonus,
      currentCountdown: countdownTime,
      currentPlayerIndex,
      settingExtraTimeTurns,
      playerRemainingTurns,
      remainingTurns,
      hasLimitedExtraTimeTurns,
    });

    if (!isStarted || !currentSettings || !baseCountdown) {
      console.log('[Extension] blocked: invalid state');
      return;
    }

    if (hasLimitedExtraTimeTurns && Number(remainingTurns || 0) <= 0) {
      console.log('[Extension] blocked: no extra turns left');
      return;
    }

    const appliedBonus =
      configuredBonus > 0
        ? configuredBonus
        : baseCountdown > 0
          ? baseCountdown
          : 35;

    if (hasLimitedExtraTimeTurns) {
      const safeRemainingTurns = Math.max(0, Number(remainingTurns || 0));
      const nextRemainingTurns = Math.max(0, safeRemainingTurns - 1);

      const nextPlayerSettings = {
        ...currentSettings,
        playingPlayers: (currentSettings.playingPlayers || []).map(
          (player, index) => {
            if (index !== currentPlayerIndex) {
              return player;
            }

            return {
              ...player,
              proMode: {
                ...(player.proMode || {}),
                extraTimeTurns: nextRemainingTurns,
              },
            } as Player;
          },
        ),
      } as PlayerSettings;

      // Important: update playerSettingsRef synchronously before adding time.
      // Remote HID can fire very quickly; checking stale React state allowed
      // spamming Extension beyond the configured turn limit.
      setPlayerSettings(nextPlayerSettings);

      console.log('[Extension] extra turn consumed v12-limit-fix', {
        before: safeRemainingTurns,
        after: nextRemainingTurns,
      });
    }

    setCountdownTime(prev => {
      const safePrev = Number.isFinite(prev) ? prev : baseCountdown;
      const next = safePrev + appliedBonus;
      console.log('[Extension] countdown update', {safePrev, appliedBonus, next});
      return next;
    });

    setIsMatchPaused(false);
  }, [
    countdownTime,
    currentPlayerIndex,
    gameSettings,
    isStarted,
    playerSettings,
    setCountdownTime,
    setIsMatchPaused,
    setPlayerSettings,
  ]);

  const onViolate = useCallback(
    (playerIndex: number, reset?: boolean) => {
      if (!isStarted || !playerSettings || winner) {
        return;
      }

      if (
        playerIndex < 0 ||
        playerIndex >= (playerSettings.playingPlayers?.length || 0)
      ) {
        return;
      }

      const players = playerSettings.playingPlayers || [];
      const triggeredPlayer = players[playerIndex];
      const oldFoulCount = Number(triggeredPlayer?.violate || 0);
      const nextViolate = reset ? 0 : oldFoulCount + 1;
      const opponentIndex = players.findIndex((_, index) => index !== playerIndex);
      const isThreeFoulPenalty = !reset && nextViolate >= 3 && opponentIndex >= 0;
      const opponentPlayer = isThreeFoulPenalty ? players[opponentIndex] : undefined;
      const opponentScoreBefore = Number(opponentPlayer?.totalPoint || 0);
      const opponentScoreDelta = isThreeFoulPenalty
        ? clampScoreDeltaToGoal(
            opponentScoreBefore,
            1,
            getTargetGoalValue(gameSettings),
          )
        : 0;
      const opponentScoreAfter = opponentScoreBefore + opponentScoreDelta;
      const matchPausedBefore = Boolean(isPaused || isMatchPaused);
      const timerRunningBefore = Boolean(isStarted && !isPaused && !isMatchPaused);
      const recordingActiveBefore = Boolean(
        isRecordingRef.current ||
          isRecording ||
          shouldStartRecordingRef.current ||
          pendingStartRecordingRef.current,
      );

      const extraTimeTurns = gameSettings?.mode?.extraTimeTurns;
      const newPlayingPlayers = players.map((player, index) => {
        if (isThreeFoulPenalty) {
          return {
            ...player,
            totalPoint:
              index === opponentIndex
                ? Number(player.totalPoint || 0) +
                  clampScoreDeltaToGoal(
                    Number(player.totalPoint || 0),
                    1,
                    getTargetGoalValue(gameSettings),
                  )
                : player.totalPoint,
            violate: 0,
            scoredBalls: [],
            proMode: player.proMode
              ? {
                  ...player.proMode,
                  currentPoint: 0,
                  extraTimeTurns:
                    typeof extraTimeTurns === 'number'
                      ? extraTimeTurns
                      : player.proMode.extraTimeTurns,
                }
              : player.proMode,
          } as Player;
        }

        if (playerIndex === index) {
          return {
            ...player,
            violate: nextViolate,
          } as Player;
        }

        return player;
      });

      setPlayerSettings({...playerSettings, playingPlayers: newPlayingPlayers});

      if (!isThreeFoulPenalty) {
        return;
      }

      pendingNewGameAfterViolateRef.current = false;
      setWinner(undefined);
      setGameBreakEnabled(false);
      setWarmUpCountdownTime(undefined);
      clearInterval(warmUpCountdownInterval);

      if (gameSettings?.mode?.countdownTime) {
        const extraTimeBonus = isPoolGame(gameSettings?.category)
          ? gameSettings.mode?.extraTimeBonus || 0
          : 0;
        setCountdownTime(gameSettings.mode.countdownTime + extraTimeBonus);
      }

      if (isPoolGame(gameSettings?.category)) {
        setPoolBreakEnabled(!isPool15FreeGame(gameSettings?.category));
      }

      if (isPool15OnlyGame(gameSettings?.category)) {
        setPool8SetWinnerIndex(null);
        setPool8Trackers(prev =>
          resetPool8Trackers(getSafePool8Trackers(prev)),
        );
      }

      if (isPool15FreeGame(gameSettings?.category)) {
        setPool8FreeSetWinnerIndex(null);
        setPool8FreeHole10Scores(prev => prev.map(() => 0));
      }

      const playerNumber = Math.max(1, Number(gameSettings?.players?.playerNumber || players.length || 1));
      const nextRackPlayerIndex =
        poolBreakPlayerIndex + 1 > playerNumber - 1
          ? 0
          : poolBreakPlayerIndex + 1;

      setPoolBreakPlayerIndex(nextRackPlayerIndex);
      setCurrentPlayerIndex(nextRackPlayerIndex);
      setIsPaused(false);
      setIsMatchPaused(false);

      const timerRunningAfter = true;
      const recordingActiveAfter = Boolean(
        isRecordingRef.current ||
          isRecording ||
          shouldStartRecordingRef.current ||
          pendingStartRecordingRef.current ||
          recordingActiveBefore,
      );

      console.log('[ThreeFoulPenalty]', {
        triggeredPlayerId: (triggeredPlayer as any)?.id ?? playerIndex,
        opponentPlayerId: (opponentPlayer as any)?.id ?? opponentIndex,
        oldFoulCount,
        opponentScoreBefore,
        opponentScoreAfter,
        matchPausedBefore,
        matchPausedAfter: false,
        timerRunningBefore,
        timerRunningAfter,
        recordingActiveBefore,
        recordingActiveAfter,
        calledPauseFunction: false,
        calledRecordingStop: false,
        newRackState: {
          currentPlayerIndex: nextRackPlayerIndex,
          poolBreakPlayerIndex: nextRackPlayerIndex,
          foulsReset: true,
          scoredBallsReset: true,
          matchContinues: true,
        },
      });

      console.log('[RecordingContinuity]', {
        reason: 'three-foul-penalty',
        historyRecordingStillActive: recordingActiveAfter,
        segmentNotFinalized: true,
        videoNotSplit: true,
        activeMatchId: matchSessionIdRef.current,
        webcamFolderName,
        activeSegmentIndex: currentReplaySegmentIndexRef.current,
        completedSegments: replayCompletedSegmentsRef.current,
      });
    },
    [
      gameSettings,
      isMatchPaused,
      isPaused,
      isRecording,
      isStarted,
      playerSettings,
      poolBreakPlayerIndex,
      webcamFolderName,
      winner,
    ],
  );

  const onSelectWinnerByIndex = useCallback(
    (playerIndex: number, addMatchPoint?: boolean) => {
      if (!playerSettings?.playingPlayers?.[playerIndex]) {
        return;
      }

      const targetPlayer = playerSettings.playingPlayers[playerIndex];

      if (addMatchPoint) {
        const targetGoal = getTargetGoalValue(gameSettings);
        const currentTotalPoint = Number(targetPlayer.totalPoint || 0);
        const actualAddedPoint = clampScoreDeltaToGoal(
          currentTotalPoint,
          1,
          targetGoal,
        );

        if (actualAddedPoint !== 0) {
          setPlayerSettings(
            prev =>
              ({
                ...prev,
                playingPlayers: prev?.playingPlayers.map((player, currentIndex) => {
                  if (playerIndex === currentIndex) {
                    return {
                      ...player,
                      totalPoint: Number(player.totalPoint || 0) + actualAddedPoint,
                    } as Player;
                  }

                  return player;
                }),
              } as PlayerSettings),
          );
        }

        // v13: ăn bi/chốt ván chỉ cộng điểm đến tối đa điểm mục tiêu;
        // chưa tự báo thắng trận, phải bấm Kết thúc mới hiện người thắng.
        setIsMatchPaused(true);
        return;
      }

      const announcedWinnerPlayer = targetPlayer;
      setWinner(announcedWinnerPlayer);
      setIsStarted(false);
      setIsPaused(false);
      setIsMatchPaused(true);

      showWinnerAlertAndGoBack(announcedWinnerPlayer);
    },
    [gameSettings, playerSettings, showWinnerAlertAndGoBack],
  );

  const onSelectWinner = useCallback(() => {
    onSelectWinnerByIndex(
      currentPlayerIndex,
      isPool9Game(gameSettings?.category) || isPool10Game(gameSettings?.category),
    );
  }, [currentPlayerIndex, gameSettings?.category, onSelectWinnerByIndex]);

  const onClearWinner = useCallback(() => {
    if (!playerSettings) {
      return;
    }

    const newPlayingPlayers = playerSettings?.playingPlayers.map(player => {
      return {...player, scoredBalls: undefined} as Player;
    });

    winnerAlertShownRef.current = false;
    setPlayerSettings({...playerSettings, playingPlayers: newPlayingPlayers});
    setWinner(undefined);
  }, [playerSettings]);

  const onPool15OnlyScore = useCallback(
    (playerIndex: number) => {
      if (
        !isStarted ||
        !playerSettings ||
        !isPool15OnlyGame(gameSettings?.category) ||
        winner
      ) {
        return;
      }

      const targetPlayer = playerSettings.playingPlayers[playerIndex];
      if (!targetPlayer) {
        return;
      }

      const targetGoal = getTargetGoalValue(gameSettings);
      const maxPoint = targetGoal > 0 ? Math.min(8, targetGoal) : 8;
      const nextPoint = Math.min(maxPoint, Number(targetPlayer.totalPoint || 0) + 1);
      const newPlayingPlayers = playerSettings.playingPlayers.map(
        (player, index) => {
          if (index === playerIndex) {
            return {
              ...player,
              totalPoint: nextPoint,
            } as Player;
          }

          return player;
        },
      );

      setPlayerSettings({...playerSettings, playingPlayers: newPlayingPlayers});

      if (nextPoint >= 8) {
        console.log('[TargetScoreLimit] pool15-only point reached; wait for end button v13', {
          playerIndex,
          nextPoint,
        });
        setIsMatchPaused(true);
      }
    },
    [
      gameSettings?.category,
      isStarted,
      playerSettings,
      winner,
      showWinnerAlertAndGoBack,
    ],
  );

  const onIncrementPool8FreeHole10 = useCallback((playerIndex: number) => {
    setPool8FreeHole10Scores(prev =>
      prev.map((score, index) => (index === playerIndex ? score + 1 : score)),
    );
  }, []);

  const onDecrementPool8FreeHole10 = useCallback((playerIndex: number) => {
    setPool8FreeHole10Scores(prev =>
      prev.map((score, index) =>
        index === playerIndex ? Math.max(0, score - 1) : score,
      ),
    );
  }, []);

  const onSwapPool8Groups = useCallback(() => {
    if (!isPool15OnlyGame(gameSettings?.category)) {
      return;
    }

    setPool8Trackers(prev => {
      const next = Array.isArray(prev) && prev.length >= 2 ? [...prev] : buildDefaultPool8Trackers();
      return [next[1], next[0]];
    });
  }, [gameSettings?.category]);

  const onPressPool8Ball = useCallback(
    (playerIndex: number) => {
      if (
        !isStarted ||
        !playerSettings ||
        !isPool15OnlyGame(gameSettings?.category) ||
        winner ||
        poolBreakEnabled ||
        isPaused ||
        isMatchPaused ||
        pool8SetWinnerIndex !== null ||
        playerIndex !== currentPlayerIndex
      ) {
        return;
      }

      const tracker = pool8Trackers[playerIndex];
      const activeBall = tracker?.sequence?.[tracker.activeIndex];
      if (activeBall == null) {
        return;
      }

      if (activeBall === BallType.B8) {
        const targetGoal = getTargetGoalValue(gameSettings);
        const updatedPlayers = playerSettings.playingPlayers.map((player, index) =>
          index === playerIndex
            ? ({
                ...player,
                totalPoint:
                  Number(player.totalPoint || 0) +
                  clampScoreDeltaToGoal(
                    Number(player.totalPoint || 0),
                    1,
                    targetGoal,
                  ),
              } as Player)
            : player,
        );

        setPlayerSettings({...playerSettings, playingPlayers: updatedPlayers});
        setPool8SetWinnerIndex(playerIndex);
        setIsMatchPaused(true);

        const setWinnerPlayer = updatedPlayers[playerIndex];

        if (Number(setWinnerPlayer?.totalPoint || 0) >= targetGoal && targetGoal > 0) {
          console.log('[TargetScoreLimit] target reached; wait for end button v13', {
            playerIndex,
            targetGoal,
            score: Number(setWinnerPlayer?.totalPoint || 0),
          });
        }

        return;
      }

      setPool8Trackers(prev =>
        prev.map((item, index) =>
          index === playerIndex
            ? {
                ...item,
                activeIndex: Math.min(item.sequence.length - 1, item.activeIndex + 1),
              }
            : item,
        ),
      );
    },
    [
      currentPlayerIndex,
      gameSettings?.category,
      gameSettings?.players?.goal?.goal,
      isMatchPaused,
      isPaused,
      isStarted,
      playerSettings,
      pool8SetWinnerIndex,
      pool8Trackers,
      poolBreakEnabled,
      showWinnerAlertAndGoBack,
      winner,
    ],
  );

  const onPoolScore = useCallback(
    (ball: PoolBallType) => {
      if (
        !isStarted ||
        !playerSettings ||
        !isPoolGame(gameSettings?.category) ||
        winner
      ) {
        return;
      }

      if (isPool15FreeGame(gameSettings?.category) && pool8FreeSetWinnerIndex !== null) {
        return;
      }

      if (isPool15OnlyGame(gameSettings?.category)) {
        return;
      }

      const newPlayingPlayers = playerSettings.playingPlayers.map(
        (player, index) => {
          if (currentPlayerIndex === index) {
            const nextScoredBalls = [...(player.scoredBalls || []), ball];
            return {
              ...player,
              scoredBalls: nextScoredBalls,
              totalPoint: isPool15FreeGame(gameSettings?.category)
                ? player.totalPoint
                : player.totalPoint,
            } as Player;
          }

          return player;
        },
      );

      if (isPool15FreeGame(gameSettings?.category)) {
        const nextCurrentPlayer = newPlayingPlayers[currentPlayerIndex];
        const scoredCount = nextCurrentPlayer?.scoredBalls?.length || 0;

        if (scoredCount >= 8) {
          const targetGoal = getTargetGoalValue(gameSettings);
          const updatedPlayers = newPlayingPlayers.map((player, index) =>
            index === currentPlayerIndex
              ? ({
                  ...player,
                  totalPoint:
                    Number(player.totalPoint || 0) +
                    clampScoreDeltaToGoal(
                      Number(player.totalPoint || 0),
                      1,
                      targetGoal,
                    ),
                } as Player)
              : player,
          );

          setPlayerSettings({...playerSettings, playingPlayers: updatedPlayers});
          setPool8FreeSetWinnerIndex(currentPlayerIndex);
          setIsMatchPaused(true);

          const setWinnerPlayer = updatedPlayers[currentPlayerIndex];
          if (Number(setWinnerPlayer?.totalPoint || 0) >= targetGoal && targetGoal > 0) {
            console.log('[TargetScoreLimit] target reached; wait for end button v13', {
              playerIndex: currentPlayerIndex,
              targetGoal,
              score: Number(setWinnerPlayer?.totalPoint || 0),
            });
          }
          return;
        }

        setPlayerSettings({...playerSettings, playingPlayers: newPlayingPlayers});
        return;
      }

      setPlayerSettings({...playerSettings, playingPlayers: newPlayingPlayers});

      switch (true) {
        case isPool9Game(gameSettings?.category):
        case isPool15OnlyGame(gameSettings?.category):
          if (ball.number === BallType.B9) {
            onSelectWinner();
          }
          break;
        case isPool10Game(gameSettings?.category):
          if (ball.number === BallType.B10) {
            onSelectWinner();
          }
          break;
        default:
          break;
      }
    },
    [
      currentPlayerIndex,
      gameSettings?.category,
      gameSettings?.players?.goal?.goal,
      isStarted,
      onSelectWinner,
      playerSettings,
      pool8FreeSetWinnerIndex,
      winner,
      showWinnerAlertAndGoBack,
    ],
  );

  const onSwitchTurn = useCallback(() => {
    _resetCountdown();

    const player0: Player = {
      ...playerSettings?.playingPlayers[0],
      color: playerSettings?.playingPlayers[1].color,
    } as Player;
    const player1: Player = {
      ...playerSettings?.playingPlayers[1],
      color: playerSettings?.playingPlayers[0].color,
    } as Player;

    setPlayerSettings({
      ...playerSettings,
      playingPlayers: [player0, player1],
    } as PlayerSettings);
  }, [_resetCountdown, playerSettings]);

  const onSwitchPoolBreakPlayerIndex = useCallback(
    (index: number, callback?: (playerIndex: number) => void) => {
      if (!gameSettings) {
        return;
      }
      let newPoolBreakPlayerIndex = 0;

      if (index + 1 > gameSettings.players.playerNumber - 1) {
        newPoolBreakPlayerIndex = 0;
      } else {
        newPoolBreakPlayerIndex = index + 1;
      }

      setPoolBreakPlayerIndex(newPoolBreakPlayerIndex);

      if (callback) {
        callback(newPoolBreakPlayerIndex);
      }
    },
    [gameSettings],
  );

  const onIncreaseTotalTurns = useCallback(() => {
    setTotalTurns(prev => prev + 1);
  }, []);

  const onDecreaseTotalTurns = useCallback(() => {
    setTotalTurns(prev => (prev > 1 ? prev - 1 : 1));
  }, []);

  const onToggleSound = useCallback(() => {
    setSoundEnabled(prev => !prev);
  }, []);

  const onToggleProMode = useCallback(() => {
    if (isPoolGame(gameSettings?.category)) {
      return;
    }

    setProModeEnabled(prev => !prev);
  }, [gameSettings?.category]);

  const onPoolBreak = useCallback(() => {
    if (
      !isStarted ||
      isPaused ||
      !poolBreakEnabled ||
      !gameSettings
    ) {
      return;
    }

    if (gameSettings.mode?.mode !== 'quick_match') {
      if (!gameSettings.mode?.countdownTime) {
        return;
      }
      const extraTimeBonus = gameSettings.mode?.extraTimeBonus || 0;
      setCountdownTime(gameSettings.mode?.countdownTime! + extraTimeBonus);
    } else {
      setCountdownTime(0);
    }

    setPoolBreakEnabled(false);
    setIsMatchPaused(false);
    setIsStarted(true);

    if (isPool15OnlyGame(gameSettings?.category)) {
      setPool8Trackers(prev => resetPool8Trackers(getSafePool8Trackers(prev)));
      setPool8SetWinnerIndex(null);
    }
  }, [gameSettings, isStarted, isPaused, poolBreakEnabled]);

  const getWarmUpTimeString = useCallback(() => {
    if (!warmUpCountdownTime) {
      return '';
    }

    const minutes = Math.floor(warmUpCountdownTime / 60);
    const seconds = Math.floor(warmUpCountdownTime % 60);

    return `${minutes < 10 ? '0' : ''}${minutes}:${
      seconds < 10 ? '0' : ''
    }${seconds}`;
  }, [warmUpCountdownTime]);

  const onWarmUp = useCallback(() => {
    if (
      !gameSettings?.mode?.warmUpTime ||
      (typeof warmUpCountdownTime === 'number' && warmUpCountdownTime > 0) ||
      (typeof warmUpCount === 'number' && warmUpCount <= 0)
    ) {
      return;
    }

    setWarmUpCount(prev => (prev ? prev - 1 : 0));
    setWarmUpCountdownTime(gameSettings?.mode?.warmUpTime);
  }, [gameSettings, warmUpCount, warmUpCountdownTime]);

  const onGameBreak = useCallback(() => {
    setGameBreakEnabled(true);
    setWarmUpCountdownTime(1);
  }, []);

  const onEndWarmUp = useCallback(() => {
    setWarmUpCountdownTime(undefined);
    setGameBreakEnabled(false);
    clearInterval(warmUpCountdownInterval);
  }, []);

  const moveWarmUpToNextPlayer = useCallback(() => {
    const totalPlayers = Math.max(
      1,
      Number(
        playerSettings?.playingPlayers?.length ||
          gameSettings?.players?.playingPlayers?.length ||
          gameSettings?.players?.playerNumber ||
          1,
      ),
    );
    const nextPlayerIndex =
      currentPlayerIndex + 1 > totalPlayers - 1 ? 0 : currentPlayerIndex + 1;

    setCurrentPlayerIndex(nextPlayerIndex);
    setPoolBreakPlayerIndex(nextPlayerIndex);
  }, [currentPlayerIndex, gameSettings, playerSettings]);

  const onQuickMatchWarmUpNext = useCallback(() => {
    if (gameSettings?.mode?.mode !== 'quick_match') {
      onEndWarmUp();
      return;
    }

    const hasRunningWarmUp =
      typeof warmUpCountdownTime === 'number' && warmUpCountdownTime > 0;
    if (!hasRunningWarmUp) {
      onWarmUp();
      return;
    }

    clearInterval(warmUpCountdownInterval);
    setGameBreakEnabled(false);
    setWarmUpCountdownTime(undefined);

    const remainingWarmUps = Math.max(0, Number(warmUpCount || 0));
    if (remainingWarmUps <= 0) {
      setWarmUpCount(0);
      return;
    }

    moveWarmUpToNextPlayer();
    setWarmUpCount(Math.max(0, remainingWarmUps - 1));
    setWarmUpCountdownTime(gameSettings?.mode?.warmUpTime);
  }, [gameSettings, moveWarmUpToNextPlayer, onEndWarmUp, onWarmUp, warmUpCount, warmUpCountdownTime]);

  useEffect(() => {
    if (gameSettings?.mode?.mode !== 'quick_match') {
      return;
    }

    if (warmUpCountdownTime !== 0) {
      return;
    }

    clearInterval(warmUpCountdownInterval);
    setWarmUpCountdownTime(undefined);
    setGameBreakEnabled(false);

    if (Math.max(0, Number(warmUpCount || 0)) > 0) {
      moveWarmUpToNextPlayer();
    }
  }, [gameSettings?.mode?.mode, moveWarmUpToNextPlayer, warmUpCount, warmUpCountdownTime]);

  const onEndTurn = useCallback(
    (isPrevious?: boolean) => {
      if (!gameSettings || !isStarted) {
        return;
      }

      const totalPlayers = Math.max(
        2,
        playerSettings?.playingPlayers?.length ||
          gameSettings.players?.playingPlayers?.length ||
          0,
      );

      let nextPlayerIndex = 0,
        newTotalTurns: number | null = null;

      switch (true) {
        case isPrevious && currentPlayerIndex - 1 < 0:
          nextPlayerIndex = totalPlayers - 1;
          newTotalTurns = totalTurns + 1;
          break;
        case isPrevious:
          nextPlayerIndex = currentPlayerIndex - 1;
          break;
        case !isPrevious && currentPlayerIndex + 1 > totalPlayers - 1:
          nextPlayerIndex = 0;
          newTotalTurns = totalTurns + 1;
          break;
        default:
          nextPlayerIndex = currentPlayerIndex + 1;
          break;
      }

      const completedTurns = Math.max(1, totalTurns + 1);

      setIsMatchPaused(false);
      setCurrentPlayerIndex(nextPlayerIndex);
      _resetCountdown();

      setPlayerSettings(
        prev =>
          ({
            ...prev,
            playingPlayers: prev?.playingPlayers.map((player, playerIndex) => {
              if (playerIndex === currentPlayerIndex) {
                const currentPoint = Number(player.proMode?.currentPoint || 0);
                const {highestRate, secondHighestRate} = getTopTwoRuns(
                  player,
                  currentPoint,
                );
                const average = Number(
                  (
                    Number(player.totalPoint || 0) /
                    completedTurns
                  ).toFixed(2),
                );

                return {
                  ...player,
                  proMode: {
                    ...player.proMode,
                    highestRate,
                    secondHighestRate,
                    average,
                    currentPoint: 0,
                  },
                };
              }

              return {
                ...player,
                proMode: {
                  ...player.proMode,
                  currentPoint: 0,
                },
              };
            }),
          } as PlayerSettings),
      );

      if (newTotalTurns !== null) {
        setTotalTurns(newTotalTurns);
      }
    },
    [
      isStarted,
      currentPlayerIndex,
      totalTurns,
      gameSettings,
      playerSettings,
      _resetCountdown,
    ],
  );

  const onResetTurn = useCallback(() => {
    if (!gameSettings || !isStarted) {
      return;
    }

    _resetCountdown();

    setTotalTurns(totalTurns + 1);
    setIsMatchPaused(false);
  }, [isStarted, gameSettings, totalTurns, _resetCountdown]);

  const onSwapPlayers = useCallback(() => {
    setPlayerSettings(currentSettings => {
      const playingPlayers = currentSettings?.playingPlayers || [];
      if (playingPlayers.length < 2) {
        return currentSettings;
      }

      const nextPlayers = playingPlayers.map(player => ({...player}));
      const firstName = nextPlayers[0]?.name || '';
      const secondName = nextPlayers[1]?.name || '';

      nextPlayers[0] = {
        ...nextPlayers[0],
        name: secondName,
      } as Player;
      nextPlayers[1] = {
        ...nextPlayers[1],
        name: firstName,
      } as Player;

      return {
        ...currentSettings,
        playingPlayers: nextPlayers,
      } as PlayerSettings;
    });
  }, []);

  const dismissYouTubeLiveOverlay = useCallback(() => {
    setYoutubeLiveOverlay(null);
  }, []);

  const openYouTubeLiveLogin = useCallback(() => {
    setYoutubeLiveOverlay(null);
    navigate(screens.livePlatformSetupYoutube, {
      livestreamPlatform: 'youtube',
      saveToDeviceWhileStreaming,
    });
  }, [saveToDeviceWhileStreaming]);

  const buildYouTubeLiveOverlay = useCallback(
    (
      eligibility: YouTubeEligibilityResponse | null,
      fallbackMessage?: string,
    ): YouTubeLiveOverlayState => {
      const subscriberCount = eligibility?.subscriberCount;
      const hiddenSubscriberCount = Boolean(eligibility?.hiddenSubscriberCount);
      const liveEnabled = eligibility?.liveEnabled;
      const liveEnabledReason = eligibility?.liveEnabledReason || fallbackMessage || '';

      const subscriberCheck: YouTubeEligibilityCheck = {
        key: 'subscribers',
        label: i18n.t('youtubeLiveSubscriberRequirement'),
        status:
          typeof subscriberCount === 'number'
            ? subscriberCount >= 50
              ? 'pass'
              : 'fail'
            : hiddenSubscriberCount
            ? 'unknown'
            : 'unknown',
        detail:
          typeof subscriberCount === 'number'
            ? i18n.t('youtubeLiveSubscriberCountDetail', {count: subscriberCount})
            : hiddenSubscriberCount
            ? i18n.t('youtubeLiveHiddenSubscriberDetail')
            : i18n.t('youtubeLiveUnknownSubscriberDetail'),
      };

      const liveEnabledCheck: YouTubeEligibilityCheck = {
        key: 'liveEnabled',
        label: i18n.t('youtubeLiveEnabledRequirement'),
        status:
          liveEnabled === true ? 'pass' : liveEnabled === false ? 'fail' : 'unknown',
        detail:
          liveEnabled === true
            ? i18n.t('youtubeLiveEnabledDetail')
            : liveEnabled === false
            ? liveEnabledReason || i18n.t('youtubeLiveDisabledDetail')
            : i18n.t('youtubeLiveUnknownEnabledDetail'),
      };

      return {
        visible: true,
        title: i18n.t('youtubeLiveEligibilityTitle'),
        message:
          fallbackMessage ||
          eligibility?.message ||
          i18n.t('youtubeLiveEligibilityDefaultMessage'),
        checks: [subscriberCheck, liveEnabledCheck],
      };
    },
    [language],
  );

  const showYouTubeLiveFailure = useCallback(
    (
      eligibility: YouTubeEligibilityResponse | null,
      fallbackMessage?: string,
    ) => {
      const overlayState = buildYouTubeLiveOverlay(eligibility, fallbackMessage);
      console.log('[YouTubeLiveEligibilityOverlay]', {
        visible: true,
        title: overlayState.title,
        checks: overlayState.checks?.map(check => ({
          key: check.key,
          label: check.label,
          status: check.status,
          detail: check.detail,
        })),
        willReturnToSetup: true,
      });
      setYoutubeLiveOverlay(overlayState);
    },
    [buildYouTubeLiveOverlay],
  );


  const onStart = useCallback(async () => {
    if (isStarted) {
      return;
    }

    if (
      gameSettings?.mode?.mode === 'quick_match' &&
      ((typeof warmUpCountdownTime === 'number' && warmUpCountdownTime >= 0) ||
        Number(warmUpCount || 0) > 0)
    ) {
      console.log('[QuickMatch] start blocked until warm-up is finished', {
        warmUpCount,
        warmUpCountdownTime,
      });
      return;
    }

    const freeDisk =
      (await DeviceInfo.getFreeDiskStorage()) / (1024 * 1024 * 1024);

    console.log('Free disk storae ' + freeDisk);

    if (freeDisk <= 10) {
      Alert.alert(i18n.t('txtwarn'), i18n.t('msgOutOfMemory'), [
        {
          text: i18n.t('txtCancel'),
          style: 'cancel',
        },
        {
          text: i18n.t('btnHistory'),
          onPress: () => {
            navigate(screens.history);
          },
        },
      ]);
      return;
    }

    console.log('[Replay] onStart pressed');
    console.log('[YouTube Live] start button pressed');
    console.log('[Live Flow] start pressed');
    console.log('[Live Flow] selectedPlatform=' + String(selectedLivestreamPlatform || 'none'));
    console.log('[Live Flow] youtubeConnected=unknown-before-api-check');
    console.log('[Live Flow] shouldCreateYouTubeLive=' + String(shouldUseYouTubeLive));
    console.log('[Live Flow] routePlatform=' + String(routeParams.livestreamPlatform || 'none'));
    console.log('[Live] selected platform:', selectedLivestreamPlatform, {
      saveToDeviceWhileStreaming,
      shouldUseYouTubeLive,
      shouldUseLocalRecordingOnly,
    });

    const currentSource = getCurrentCameraSource();
    const availableSources = normalizeAvailableCameraSources(
      getAvailableCameraSources(),
    );
    const hasExternalSource =
      hasDetectedUvcSource() && availableSources.includes('external');

    const lockedLiveSource = resolveLockedLiveSource(
      currentSource,
      availableSources,
    );

    if (currentSource === 'external' && !hasExternalSource) {
      Alert.alert(
        i18n.t('cameraUsbMissingTitle'),
        i18n.t('cameraUsbMissingMessage'),
      );
      return;
    }

    if (!lockedLiveSource) {
      Alert.alert(
        i18n.t('cameraNotFoundTitle'),
        i18n.t('cameraNotFoundMessage'),
      );
      return;
    }

    const nativeSourceType =
      lockedLiveSource === 'external' ? 'webcam' : 'phone';
    const nativePhoneFacing = lockedLiveSource === 'front' ? 'front' : 'back';

    if (!shouldUseYouTubeLive) {
      console.log('[Live Flow] skip create reason=selectedPlatform is not youtube', {
        selectedLivestreamPlatform,
        currentSource,
        availableSources,
        lockedLiveSource,
      });
      console.log('[Live Flow] local recording active reason=selectedPlatform is not youtube');
      console.log('[Live] local recording mode only:', {
        selectedLivestreamPlatform,
        currentSource,
        availableSources,
        lockedLiveSource,
      });

      pendingYouTubeNativeStartRef.current = null;
      activeYouTubeBroadcastIdRef.current = '';
      setYoutubeLiveOverlay(null);
      setYoutubeLivePreparing(false);
      setYoutubeLivePreviewActive(false);
      setYouTubeNativeCameraLock(false);
      setYouTubeSourceLock(null);
      setActiveGameplaySessionSync({
        matchSessionId: matchSessionIdRef.current,
        webcamFolderName,
        savedAt: Date.now(),
        source: 'on-start-local-recording',
      });
      shouldStartRecordingRef.current = true;
      pendingStartRecordingRef.current = true;
      if (gameSettings?.mode?.mode === 'quick_match' && isPoolGame(gameSettings?.category)) {
        setPoolBreakEnabled(!isPool15FreeGame(gameSettings?.category));
      }
      setCountdownTime(gameSettings?.mode?.mode === 'quick_match' ? 0 : countdownTime);
      setIsStarted(true);
      return;
    }

    if (Platform.OS === 'windows' && shouldUseYouTubeLive) {
      console.log('[LiveWindowsMode]', {
        selectedMode: 'ffmpeg-local-oauth',
        usesNgrok: false,
        usesMetro: false,
        usesRenderForAuth: true,
        usesRenderForStream: false,
      });

      shouldStartRecordingRef.current = saveToDeviceWhileStreaming;
      pendingStartRecordingRef.current = saveToDeviceWhileStreaming;
      pendingYouTubeNativeStartRef.current = null;
      setYoutubeLiveOverlay(null);
      setYoutubeLivePreparing(true);
      setYoutubeLivePreviewActive(false);
      setYouTubeNativeCameraLock(false);
      setYouTubeSourceLock(null);

      const firstPlayerName =
        playerSettingsRef.current?.playingPlayers?.[0]?.name?.trim() ||
        playerSettings?.playingPlayers?.[0]?.name?.trim() ||
        'Player 1';
      const secondPlayerName =
        playerSettingsRef.current?.playingPlayers?.[1]?.name?.trim() ||
        playerSettings?.playingPlayers?.[1]?.name?.trim() ||
        'Player 2';
      const youtubeTitle = `${firstPlayerName} vs ${secondPlayerName} - ${new Date().toLocaleString()}`;

      const resolveIngestion = (session: any) => {
        const streamUrlWithKey = String(session?.streamUrlWithKey || '').trim();
        const streamUrl = String(
          session?.streamUrl ||
            session?.ingestionAddress ||
            session?.cdn?.ingestionInfo?.ingestionAddress ||
            '',
        ).trim();
        const streamName = String(
          session?.streamName ||
            session?.streamKey ||
            session?.cdn?.ingestionInfo?.streamName ||
            '',
        ).trim();

        if (streamUrl && streamName) {
          return {rtmpUrl: streamUrl.replace(/\/+$/g, ''), streamKey: streamName};
        }

        if (streamUrlWithKey) {
          const clean = streamUrlWithKey.replace(/\/+$/g, '');
          const lastSlash = clean.lastIndexOf('/');
          if (lastSlash > 0) {
            return {
              rtmpUrl: clean.slice(0, lastSlash),
              streamKey: clean.slice(lastSlash + 1),
            };
          }
        }

        return {
          rtmpUrl: streamUrl || DEFAULT_YOUTUBE_RTMP_URL,
          streamKey: streamName,
        };
      };

      const prepareWindowsFfmpegYouTubeLive = async () => {
        let liveResponse: any = null;

        try {
          const selectedLiveVisibility = await readYouTubeVisibilityFromStorage();

          liveResponse = await createYouTubeLiveSession({
            title: youtubeTitle,
            description: i18n.t("youtubeLiveDescription", {firstPlayerName, secondPlayerName}) as string,
            privacyStatus: selectedLiveVisibility,
            enableAutoStart: true,
            enableAutoStop: true,
            enableDvr: true,
            recordFromStart: true,
            resolution: '1080p',
            frameRate: '30fps',
          });

          const ingestion = resolveIngestion(liveResponse?.session);
          activeYouTubeBroadcastIdRef.current =
            liveResponse?.session?.broadcastId || liveResponse?.session?.id || '';

          console.log('[YouTube Live] created for Windows FFmpeg:', {
            broadcastId: liveResponse?.session?.broadcastId || '',
            streamId: liveResponse?.session?.streamId || '',
            hasRtmpUrl: Boolean(ingestion.rtmpUrl),
            streamKeyMasked: maskStreamKey(ingestion.streamKey),
            watchUrl: liveResponse?.session?.watchUrl || '',
          });

          if (!ingestion.streamKey) {
            throw new Error(i18n.t('youtubeBackendMissingStreamKey'));
          }

          const liveConfigItems = await AsyncStorage.multiGet([
            'WindowsFfmpegPath',
            'WindowsFfmpegCameraDevice',
            'WindowsFfmpegAudioDevice',
          ]);
          const liveConfigLookup = liveConfigItems.reduce<Record<string, string>>(
            (acc, [key, value]) => ({...acc, [key]: value || ''}),
            {},
          );

          const windowsLiveConfig: WindowsFfmpegLiveConfig = {
            platform: 'youtube',
            rtmpUrl: ingestion.rtmpUrl || DEFAULT_YOUTUBE_RTMP_URL,
            streamKey: ingestion.streamKey,
            ffmpegPath: liveConfigLookup.WindowsFfmpegPath || '',
            cameraDeviceName: liveConfigLookup.WindowsFfmpegCameraDevice || '',
            audioDeviceName: liveConfigLookup.WindowsFfmpegAudioDevice || '',
            useAudio: Boolean(liveConfigLookup.WindowsFfmpegAudioDevice),
            fps: 30,
            bitrate: '6000k',
          };

          const snapshot = createWindowsFfmpegSnapshotFromGameState({
            gameSettings,
            playerSettings: playerSettingsRef.current || playerSettings,
            currentPlayerIndex,
            countdownTime,
            totalTurns,
          });

          const startResult = await startWindowsFfmpegYouTubeLive(
            windowsLiveConfig,
            snapshot,
          );

          if (!startResult?.ok) {
            const activeYouTubeBroadcastId = activeYouTubeBroadcastIdRef.current;
            activeYouTubeBroadcastIdRef.current = '';

            if (activeYouTubeBroadcastId) {
              try {
                await stopYouTubeLiveSession(activeYouTubeBroadcastId);
                console.log('[YouTube Live] stopped broadcast after FFmpeg start failed:', activeYouTubeBroadcastId);
              } catch (youtubeStopError) {
                console.log('[YouTube Live] stop after FFmpeg start failed:', youtubeStopError);
              }
            }

            throw new Error(
              startResult?.error ||
                i18n.t('youtubeFfmpegStartFailed'),
            );
          }

          setYoutubeLivePreparing(false);
          setYoutubeLivePreviewActive(false);
          setIsStarted(true);
          setActiveGameplaySessionSync({
            matchSessionId: matchSessionIdRef.current,
            webcamFolderName,
            savedAt: Date.now(),
            source: 'windows-ffmpeg-oauth-live-start',
          });
        } catch (error: any) {
          console.log('[YouTube Live] Windows FFmpeg OAuth/create/start failed:', {
            message: error?.message || String(error),
            hasSession: Boolean(liveResponse?.session),
          });

          pendingYouTubeNativeStartRef.current = null;
          activeYouTubeBroadcastIdRef.current = '';
          setYoutubeLivePreparing(false);
          setYoutubeLivePreviewActive(false);
          setIsStarted(false);
          setYouTubeSourceLock(null);

          try {
            await stopWindowsFfmpegYouTubeLive('start-failed');
          } catch {}

          const payload = error?.payload as YouTubeEligibilityResponse | undefined;
          const fallbackMessage =
            payload?.message ||
            error?.message ||
            i18n.t('youtubeFfmpegInitFailed');

          try {
            const eligibility =
              payload?.checks?.length || payload?.subscriberCount !== undefined
                ? payload
                : await getYouTubeLiveEligibility();

            showYouTubeLiveFailure(eligibility, fallbackMessage);
          } catch (eligibilityError: any) {
            console.log('[YouTube Live] eligibility failed:', eligibilityError);

            showYouTubeLiveFailure(
              null,
              fallbackMessage ||
                eligibilityError?.message ||
                i18n.t('youtubeEligibilityCheckFailed'),
            );
          }
        }
      };

      void prepareWindowsFfmpegYouTubeLive();
      return;
    }

    setYouTubeSourceLock(lockedLiveSource);
    console.log('[YouTube Live] source resolved:', {
      currentSource,
      availableSources,
      lockedLiveSource,
      nativeSourceType,
      nativePhoneFacing,
    });
    const youtubeNativeModuleMounted = isYouTubeNativeLiveEngineMounted();
    const youtubeNativePreviewAvailable = isYouTubeNativePreviewViewAvailable();
    const youtubeNativeReady = isYouTubeNativeLiveReady();

    console.log('[YouTube Live] native engine mounted=' + youtubeNativeModuleMounted);
    console.log('[YouTube Live] native preview view available=' + youtubeNativePreviewAvailable);
    console.log('[YouTube Live] native ready=' + youtubeNativeReady);

    if (!youtubeNativeReady) {
      console.log('[YouTube Live] fallback reason=native module/view manager missing', {
        youtubeNativeModuleMounted,
        youtubeNativePreviewAvailable,
      });
      pendingYouTubeNativeStartRef.current = null;
      activeYouTubeBroadcastIdRef.current = '';
      setYoutubeLivePreparing(false);
      setYoutubeLivePreviewActive(false);
      setIsCameraReady(false);
      setIsStarted(false);
      setYouTubeNativeCameraLock(false);
      setYouTubeSourceLock(null);
      setYoutubeLiveOverlay({
        visible: true,
        title: i18n.t('youtubeLiveNotReadyTitle'),
        message:
          i18n.t('youtubeNativeModuleMissing'),
        checks: [],
      });
      return;
    }

    shouldStartRecordingRef.current = false;
    pendingStartRecordingRef.current = false;
    pendingYouTubeNativeStartRef.current = null;
    setYoutubeLiveOverlay(null);
    setYoutubeLivePreparing(true);
    setYoutubeLivePreviewActive(false);
    setIsCameraReady(false);
    setIsStarted(true);

    const firstPlayerName =
      playerSettings?.playingPlayers?.[0]?.name?.trim() || 'Player 1';
    const secondPlayerName =
      playerSettings?.playingPlayers?.[1]?.name?.trim() || 'Player 2';

    const youtubeTitle = `${firstPlayerName} vs ${secondPlayerName} - ${new Date().toLocaleString()}`;

    const prepareYouTubeLive = async () => {
      try {
        await stopYouTubeNativeLive();
        await stopVideoRecording(false);

        const selectedLiveVisibility =
          await readYouTubeVisibilityFromStorage();

        const liveResponse = await createYouTubeLiveSession({
          title: youtubeTitle,
          description: i18n.t("youtubeLiveDescription", {firstPlayerName, secondPlayerName}) as string,
          privacyStatus: selectedLiveVisibility,
          enableAutoStart: true,
          enableAutoStop: true,
        });

        console.log('[YouTube Live] created:', liveResponse?.session);
        console.log('[YouTube Live] broadcastId=' + String(liveResponse?.session?.broadcastId || ''));
        console.log('[YouTube Live] streamId=' + String(liveResponse?.session?.streamId || ''));
        console.log('[YouTube Live] rtmpUrl exists=' + Boolean(liveResponse?.session?.streamUrl));
        console.log('[YouTube Live] streamKey exists=' + Boolean(liveResponse?.session?.streamName));
        console.log('[YouTube Live] rtmpUrl received=' + Boolean(liveResponse?.session?.streamUrlWithKey));

        activeYouTubeBroadcastIdRef.current =
          liveResponse?.session?.broadcastId || liveResponse?.session?.id || '';
        console.log('[YouTube Live] active broadcast:', activeYouTubeBroadcastIdRef.current);
        pendingYouTubeNativeStartRef.current = {
          url: liveResponse.session.streamUrlWithKey,
          options: {
            width: 1920,
            height: 1080,
            fps: 30,
            bitrate: 8000 * 1024,
            audioBitrate: 128 * 1024,
            sampleRate: 44100,
            isStereo: true,
            cameraFacing: nativePhoneFacing,
            sourceType: nativeSourceType,
            rotationDegrees: 0,
          },
        };

        setYoutubeLivePreviewActive(true);
        setYoutubeLivePreparing(false);
        setYoutubeNativeStartNonce(value => value + 1);
      } catch (error: any) {
        console.log('[YouTube Live] create failed:', error);

        pendingYouTubeNativeStartRef.current = null;
        activeYouTubeBroadcastIdRef.current = '';
        setYoutubeLivePreparing(false);
        setYoutubeLivePreviewActive(false);
        setIsCameraReady(false);
        setIsStarted(false);
        setYouTubeSourceLock(null);

        try {
          await stopYouTubeNativeLive();
        } catch {}

        const payload = error?.payload as YouTubeEligibilityResponse | undefined;
        const fallbackMessage =
          payload?.message ||
          error?.message ||
          i18n.t('youtubeLiveCannotStart');

        try {
          const eligibility =
            payload?.checks?.length || payload?.subscriberCount !== undefined
              ? payload
              : await getYouTubeLiveEligibility();

          showYouTubeLiveFailure(eligibility, fallbackMessage);
        } catch (eligibilityError: any) {
          console.log('[YouTube Live] eligibility failed:', eligibilityError);

          showYouTubeLiveFailure(
            null,
            fallbackMessage ||
              eligibilityError?.message ||
              i18n.t('youtubeEligibilityCheckFailed'),
          );
        }
      }
    };

    void prepareYouTubeLive();
  }, [
    countdownTime,
    currentPlayerIndex,
    gameSettings,
    isStarted,
    playerSettings,
    readYouTubeVisibilityFromStorage,
    saveToDeviceWhileStreaming,
    routeParams.livestreamPlatform,
    selectedLivestreamPlatform,
    shouldUseLocalRecordingOnly,
    shouldUseYouTubeLive,
    showYouTubeLiveFailure,
    totalTurns,
    warmUpCount,
    warmUpCountdownTime,
    webcamFolderName,
  ]);

  const onToggleCountDown = useCallback(() => {
    if (!isStarted || isPaused) {
      return;
    }

    setIsMatchPaused(prev => !prev);
  }, [isStarted, isPaused]);

  const startNewGameAfterViolate = useCallback(() => {
    if (!playerSettings || !gameSettings) {
      return;
    }

    const refreshedPlayerSettings = {
      ...playerSettings,
      playingPlayers: playerSettings.playingPlayers.map(player => ({
        ...player,
        violate: 0,
        scoredBalls: [],
        proMode: {
          ...player.proMode,
          currentPoint: 0,
          extraTimeTurns: gameSettings?.mode?.extraTimeTurns,
        },
      })),
    } as PlayerSettings;

    setPlayerSettings(refreshedPlayerSettings);
    setWinner(undefined);
    setGameBreakEnabled(false);
    setWarmUpCountdownTime(undefined);
    clearInterval(warmUpCountdownInterval);

    if (gameSettings?.mode?.countdownTime) {
      const extraTimeBonus = isPoolGame(gameSettings?.category)
        ? gameSettings.mode?.extraTimeBonus || 0
        : 0;
      setCountdownTime(gameSettings.mode.countdownTime + extraTimeBonus);
    }

    if (isPoolGame(gameSettings?.category)) {
      setPoolBreakEnabled(!isPool15FreeGame(gameSettings?.category));
    }

    setIsMatchPaused(false);
    setPool8FreeSetWinnerIndex(null);

    onSwitchPoolBreakPlayerIndex(poolBreakPlayerIndex, playerIndex => {
      setCurrentPlayerIndex(playerIndex);
    });
  }, [
    gameSettings,
    playerSettings,
    poolBreakPlayerIndex,
    onSwitchPoolBreakPlayerIndex,
  ]);

  const onPause = useCallback(() => {
    if (isPaused) {
      void setReplayResumeSnapshot(null);
      setReplayReturnRequestSync(null);

      if (pendingNewGameAfterViolateRef.current) {
        pendingNewGameAfterViolateRef.current = false;
        startNewGameAfterViolate();
        setIsPaused(false);

        shouldStartRecordingRef.current = true;
        pendingStartRecordingRef.current = true;
        return;
      }

      _resetCountdown(true);
      setIsPaused(false);

      shouldStartRecordingRef.current = true;
      pendingStartRecordingRef.current = true;
      return;
    }

    clearInterval(countdownInterval);
    shouldStartRecordingRef.current = false;
    pendingStartRecordingRef.current = false;
    setIsPaused(true);

    void stopVideoRecording(false).catch(error => {
      console.log('[Replay] async stop on pause failed:', error);
    });
  }, [isPaused, _resetCountdown, startNewGameAfterViolate, youtubeLiveNativeMode]);

  const onReplay = useCallback(async () => {
    if (!isStarted || !isPaused || !webcamFolderName) {
      return;
    }

    try {
      shouldStartRecordingRef.current = false;
      pendingStartRecordingRef.current = false;

      await flushReplayScoreboardTimeline(webcamFolderName);

      // Chỉ mở replay khi clip gần nhất đã finalize xong.
      // Đây là chỗ dễ gây crash/blank replay nhất nếu bấm replay quá nhanh ngay sau khi pause.
      const recordedPath = youtubeLivePreviewActive
        ? null
        : await stopVideoRecording(false);
      const replayFiles = await waitForReplayFiles(webcamFolderName, 1, 8000);

      if (!recordedPath && replayFiles.length === 0) {
        Alert.alert(i18n.t('txtwarn'), i18n.t('msgReplayNotReady'));
        return;
      }

      const latestPlayerSettingsForReplay = playerSettingsRef.current || playerSettings;
      const latestWinnerForReplay = winnerRef.current || winner;
      const replayScoreSnapshot = getScoreSnapshotFromPlayerSettings(
        latestPlayerSettingsForReplay,
      );

      setActiveGameplaySessionSync({
        matchSessionId: matchSessionIdRef.current,
        webcamFolderName,
        savedAt: Date.now(),
        source: 'open-replay',
      });

      console.log('[ReplayReturnFlow]', {
        event: 'openReplay',
        scoreBeforeReplay: replayScoreSnapshot,
        scoreAfterReplayClose: undefined,
        matchIdBeforeReplay: matchSessionIdRef.current,
        matchIdAfterReplayClose: undefined,
        historyPathBeforeReplay: lastRecordedVideoPathRef.current || recordedPath,
        historyPathAfterReplayClose: undefined,
        replayCleanupTouchedHistory: false,
        replayCleanupTouchedScore: false,
      });

      await setReplayResumeSnapshot({
        matchSessionId: matchSessionIdRef.current,
        webcamFolderName,
        currentPlayerIndex,
        poolBreakPlayerIndex,
        totalTurns,
        totalTime,
        countdownTime,
        warmUpCount,
        warmUpCountdownTime,
        playerSettings: cloneReplayValue(latestPlayerSettingsForReplay),
        winner: cloneReplayValue(latestWinnerForReplay),
        isStarted,
        isPaused,
        isMatchPaused,
        gameBreakEnabled,
        poolBreakEnabled,
        soundEnabled,
        proModeEnabled,
        restoreOnNextFocus: true,
        savedAt: Date.now(),
      });

      push(screens.playback, {
        webcamFolderName,
        merged: false,
        returnToMatch: true,
        matchSessionId: matchSessionIdRef.current,
      });
    } catch (error) {
      console.log('[Replay] open replay failed:', error);
      Alert.alert(i18n.t('txtError'), i18n.t('msgReplayOpenFailed'));
    }
  }, [
    countdownTime,
    currentPlayerIndex,
    gameBreakEnabled,
    isMatchPaused,
    isPaused,
    isStarted,
    playerSettings,
    poolBreakEnabled,
    poolBreakPlayerIndex,
    proModeEnabled,
    soundEnabled,
    totalTime,
    totalTurns,
    warmUpCount,
    warmUpCountdownTime,
    webcamFolderName,
    winner,
    youtubeLivePreviewActive,
  ]);

  const onStop = useCallback(async () => {
    // v14: Nếu chưa bắt đầu trận thì nút Kết thúc vẫn là thoát trận như cũ.
    // Khi trận đã bắt đầu, nút Kết thúc chỉ chốt người thắng và hiện thông báo/overlay.
    // Người dùng bấm nút Kết thúc trong thông báo/overlay thì mới thoát khỏi trận.
    if (!isStarted) {
      Alert.alert(i18n.t('stop'), i18n.t('msgStopGame'), [
        {
          text: i18n.t('txtCancel'),
          style: 'cancel',
        },
        {
          text: i18n.t('stop'),
          onPress: () => {
            void setReplayResumeSnapshot(null);
            void setLiveMatchSnapshot(null);
            setReplayReturnRequestSync(null);
            navigateBackAfterWinner();
          },
        },
      ]);
      return;
    }

    if (isEndingGameRef.current) {
      return;
    }

    isEndingGameRef.current = true;
    setIsEndingGame(true);

    const endClickAt = Date.now();
    console.log('[END] click', endClickAt);

    const latestSettingsAtClick = playerSettingsRef.current || playerSettings;
    const optimisticFinalSettings = commitCurrentRunStatsForPlayers(
      cloneReplayValue(latestSettingsAtClick),
      totalTurnsRef.current || totalTurns,
    );
    const optimisticScore = getFinalScoreSnapshot(
      optimisticFinalSettings || latestSettingsAtClick,
    );
    const optimisticWinnerPlayer =
      winnerRef.current ||
      deriveWinnerPlayerFromScore(
        optimisticFinalSettings || latestSettingsAtClick,
        optimisticScore,
      );

    // Optimistic UI: phản hồi ngay, khoá điều khiển/nút trước khi làm các tác vụ nặng.
    if (optimisticFinalSettings) {
      setPlayerSettings(optimisticFinalSettings);
    }
    if (optimisticWinnerPlayer?.name) {
      const optimisticWinnerForUi = cloneReplayValue(optimisticWinnerPlayer);
      winnerRef.current = optimisticWinnerForUi;
      setWinner(optimisticWinnerForUi);
    }
    setIsStarted(false);
    setIsPaused(false);
    setIsMatchPaused(true);
    console.log('[END] local ended', Date.now());

    const aplusLiveScoreConfig = (gameSettings as any)?.aplusLiveScore;
    if (aplusLiveScoreConfig?.enabled && aplusLiveScoreConfig?.matchId) {
      console.log('[END] api start', Date.now());
      void finishAplusLiveScoreMatch(
        aplusLiveScoreConfig,
        Number(optimisticScore?.[0] || 0),
        Number(optimisticScore?.[1] || 0),
        {timeoutMs: 3000, fast: true},
      )
        .then(() => {
          console.log('[END] api done', Date.now());
        })
        .catch(error => {
          console.log('[END] api failed/queued', {
            at: Date.now(),
            message: (error as Error)?.message || String(error),
          });
        });
    }

    try {
      void setReplayResumeSnapshot(null);
      void setLiveMatchSnapshot(null);
      setReplayReturnRequestSync(null);
      shouldStartRecordingRef.current = false;
      pendingStartRecordingRef.current = false;
      pendingYouTubeNativeStartRef.current = null;
      setYoutubeLivePreparing(false);

      const activeYouTubeBroadcastId = activeYouTubeBroadcastIdRef.current;
      activeYouTubeBroadcastIdRef.current = '';
      setYoutubeLivePreviewActive(false);
      setIsCameraReady(false);

      // Không chờ stop YouTube/FFmpeg/camera trên nút Kết thúc.
      // Các cleanup này chạy nền để UI và LiveScore ended phản hồi ngay.
      void (async () => {
        console.log('[END] cleanup start', Date.now());
        try {
          await withEndMatchTimeout(stopYouTubeNativeLive(), 1500, 'stopYouTubeNativeLive');
          if (Platform.OS === 'windows') {
            await withEndMatchTimeout(
              stopWindowsFfmpegYouTubeLive('end-match'),
              2500,
              'stopWindowsFfmpegYouTubeLive',
            );
          }
          if (activeYouTubeBroadcastId) {
            await withEndMatchTimeout(
              stopYouTubeLiveSession(activeYouTubeBroadcastId),
              2500,
              'stopYouTubeLiveSession',
            );
            console.log('[YouTube Live] stopped broadcast:', activeYouTubeBroadcastId);
          }
        } catch (youtubeStopError) {
          console.log('[YouTube Live] background stop failed:', youtubeStopError);
        } finally {
          console.log('[END] cleanup done', Date.now());
        }
      })();

      const stoppedRecordingPath = await withEndMatchTimeout(
        stopVideoRecording(false),
        1500,
        'stopVideoRecording',
      );
      const recordedPath =
        stoppedRecordingPath ??
        lastRecordedVideoPathRef.current ??
        (await withEndMatchTimeout(
          getLatestReplaySegmentPath(),
          800,
          'getLatestReplaySegmentPath',
        ));

      let finalVideoExists = false;
      let finalVideoSize = 0;
      if (recordedPath) {
        try {
          finalVideoExists = await RNFS.exists(recordedPath);
          if (finalVideoExists) {
            const stat = await RNFS.stat(recordedPath);
            finalVideoSize = Number(stat?.size || 0);
          }
        } catch (statError) {
          console.log('[HistoryFinalize] final video stat failed', statError);
        }
      }

      console.log('[Replay] recorded path before endGame:', recordedPath);
      console.log('[EndMatchAfterReplay]', {
        currentScoreAtEnd: getScoreSnapshotFromPlayerSettings(
          playerSettingsRef.current || playerSettings,
        ),
        finalCommittedScore: getScoreSnapshotFromPlayerSettings(
          playerSettingsRef.current || playerSettings,
        ),
        historyVideoPath: recordedPath,
        replayVideoPath: undefined,
        usedVideoPathForHistory: recordedPath,
        isUsingReplayPathForHistory: false,
        showedVideoNotAvailable: false,
        reasonIfVideoUnavailable: recordedPath ? undefined : 'no-history-or-recording-file-found-yet',
      });
      console.log('[VideoAvailabilityMessage]', {
        context: 'end-match-v14-winner-first',
        messageShown: false,
        checkedPath: recordedPath,
        checkedPathType: 'history',
        exists: finalVideoExists,
        size: finalVideoSize,
        shouldShowToUser: false,
      });

      let overlayLastSettings: PlayerSettings | undefined;
      let overlayLastSnapshotScore: number[] = [];
      try {
        if (webcamFolderName) {
          await flushReplayScoreboardTimeline(webcamFolderName);
          const replayTimeline = await loadReplayScoreboardTimeline(webcamFolderName);
          const overlayLastSnapshot = replayTimeline?.entries?.length
            ? replayTimeline.entries[replayTimeline.entries.length - 1]
            : undefined;
          overlayLastSettings = overlayLastSnapshot?.playerSettings as
            | PlayerSettings
            | undefined;
          overlayLastSnapshotScore = getFinalScoreSnapshot(overlayLastSettings);
        }
      } catch (timelineError) {
        console.log('[HistoryFinalize] replay timeline load failed v14', timelineError);
      }

      const scoreBeforeFinalize = getFinalScoreSnapshot(playerSettings);
      const latestStatePlayerSettings = playerSettingsRef.current || playerSettings;
      const latestStateScore = getFinalScoreSnapshot(latestStatePlayerSettings);
      const useOverlayAsFinal =
        overlayLastSettings &&
        getScoreSnapshotTotal(overlayLastSnapshotScore) >=
          getScoreSnapshotTotal(latestStateScore);
      const finalPlayerSettings = commitCurrentRunStatsForPlayers(
        cloneReplayValue(
          useOverlayAsFinal ? overlayLastSettings : latestStatePlayerSettings,
        ),
        totalTurnsRef.current || totalTurns,
      );
      const finalCommittedScore = getFinalScoreSnapshot(finalPlayerSettings);
      const finalWinnerPlayer =
        winnerRef.current ||
        deriveWinnerPlayerFromScore(finalPlayerSettings, finalCommittedScore);
      const finalWinnerName = finalWinnerPlayer?.name;
      const finalTurn = totalTurnsRef.current;
      const finalDurationSeconds = Math.max(
        0,
        Number(totalTimeRef.current || totalTime || 0),
      );
      const exportOptions = {
        finalScore: finalCommittedScore,
        winnerName: finalWinnerName,
        finalPlayers: finalPlayerSettings?.playingPlayers,
        finalTurn,
        endedAt: Date.now(),
        durationMs: finalDurationSeconds * 1000,
      };

      if (webcamFolderName) {
        if (Platform.OS === 'windows') {
          try {
            const historyFolder = await exportMatchToArchive(
              webcamFolderName,
              exportOptions,
            );
            await deleteReplayFolder(webcamFolderName, {includeArchive: false});
            console.log('[History] savedVideoPath =', historyFolder);
            console.log('[HistoryFinalize]', {
              matchId: webcamFolderName,
              scoreBeforeFinalize,
              overlayLastSnapshotScore,
              finalCommittedScore,
              savedHistoryScore: finalCommittedScore,
              winner: finalWinnerName,
              historyRecordPath: historyFolder,
              finalVideoPath: recordedPath,
              finalVideoExists,
              finalVideoSize,
              marker: 'v14-end-button-winner-alert-before-exit',
            });
          } catch (exportError) {
            console.log('[HistoryVideo] error', exportError);
          }
        } else if (saveToDeviceWhileStreaming) {
          try {
            const historyFolder = await exportMatchToArchive(
              webcamFolderName,
              exportOptions,
            );
            await deleteReplayFolder(webcamFolderName, {includeArchive: false});
            console.log('[HistoryFinalize]', {
              matchId: webcamFolderName,
              scoreBeforeFinalize,
              overlayLastSnapshotScore,
              finalCommittedScore,
              savedHistoryScore: finalCommittedScore,
              winner: finalWinnerName,
              historyRecordPath: historyFolder,
              finalVideoPath: recordedPath,
              finalVideoExists,
              finalVideoSize,
              marker: 'v14-end-button-winner-alert-before-exit',
            });
          } catch (exportError) {
            console.log('[Replay] export full match failed:', exportError);
          }
        }
      }

      if (gameSettings) {
        dispatch(
          gameActions.endGame({
            realm,
            gameSettings: {
              ...gameSettings,
              players: finalPlayerSettings || playerSettings,
              totalTime: finalDurationSeconds || totalTime,
              webcamFolderName,
              replayPath: recordedPath,
              saveToDeviceWhileStreaming,
            },
          }),
        );
      }

      clearActiveGameplaySessionSync();
      setReplayResumeSnapshotSync(null);
      setLiveMatchSnapshotSync(null);

      if (finalPlayerSettings) {
        setPlayerSettings(finalPlayerSettings);
      }

      if (finalWinnerPlayer?.name) {
        const finalWinnerForUi = cloneReplayValue(finalWinnerPlayer);
        winnerRef.current = finalWinnerForUi;
        setWinner(finalWinnerForUi);
        setIsStarted(false);
        setIsPaused(false);
        setIsMatchPaused(true);

        const shouldUseCaromWinnerSummary =
          isCaromGame(gameSettings?.category) &&
          gameSettings?.mode?.mode === 'pro' &&
          (finalPlayerSettings?.playingPlayers?.length || 0) === 2;

        console.log('[EndMatchWinner] v14-end-button-winner-alert-before-exit', {
          winner: finalWinnerName,
          finalCommittedScore,
          showCaromSummary: shouldUseCaromWinnerSummary,
        });

        isEndingGameRef.current = false;
        setIsEndingGame(false);

        if (shouldUseCaromWinnerSummary) {
          return;
        }

        winnerAlertShownRef.current = true;
        Alert.alert(
          i18n.t('txtWin'),
          i18n.t('msgWinner', {player: finalWinnerForUi.name}),
          [
            {
              text: i18n.t('stop'),
              onPress: () => {
                winnerAlertShownRef.current = false;
                navigateBackAfterWinner();
              },
            },
          ],
          {cancelable: false},
        );
        return;
      }

      // Nếu hòa hoặc thiếu tên người chơi, vẫn không thoát âm thầm ngay.
      // Người dùng phải xác nhận Kết thúc trong thông báo này.
      isEndingGameRef.current = false;
      setIsEndingGame(false);
      Alert.alert(
        i18n.t('stop'),
        i18n.t('msgStopGame'),
        [
          {
            text: i18n.t('stop'),
            onPress: () => {
              navigateBackAfterWinner();
            },
          },
        ],
        {cancelable: false},
      );
    } catch (error) {
      isEndingGameRef.current = false;
      setIsEndingGame(false);
      console.error(JSON.stringify(error));
    }
  }, [
    dispatch,
    realm,
    totalTime,
    totalTurns,
    gameSettings,
    playerSettings,
    saveToDeviceWhileStreaming,
    webcamFolderName,
    isStarted,
    navigateBackAfterWinner,
  ]);

  const onReset = useCallback(() => {
    pendingNewGameAfterViolateRef.current = false;
    void setReplayResumeSnapshot(null);
    void setLiveMatchSnapshot(null);
    setReplayReturnRequestSync(null);
    const shouldResetRackScore = false;

    const safePlayingPlayers = Array.isArray(playerSettings?.playingPlayers)
      ? playerSettings.playingPlayers
      : [];

    const newPlayerSettings = {
      ...playerSettings,
      playingPlayers: safePlayingPlayers.map(player => ({
        ...player,
        totalPoint: shouldResetRackScore ? 0 : player.totalPoint,
        violate: 0,
        scoredBalls: [],
        proMode: {
          ...player.proMode,
          highestRate: 0,
          secondHighestRate: 0,
          average: 0,
          currentPoint: 0,
          extraTimeTurns: gameSettings?.mode?.extraTimeTurns,
        },
      })),
    } as PlayerSettings;

    setPlayerSettings(newPlayerSettings);
    setWinner(undefined);

    if (isPoolGame(gameSettings?.category)) {
      if (gameSettings?.mode?.mode === 'quick_match') {
        setCountdownTime(0);
        setPoolBreakEnabled(!isPool15FreeGame(gameSettings?.category));
      } else if (gameSettings?.mode?.countdownTime) {
        const extraTimeBonus = gameSettings.mode?.extraTimeBonus || 0;
        setCountdownTime(gameSettings.mode?.countdownTime! + extraTimeBonus);
        setPoolBreakEnabled(!isPool15FreeGame(gameSettings?.category));
      }
    }

    if (isPool15OnlyGame(gameSettings?.category)) {
      setPool8SetWinnerIndex(null);
      setPool8Trackers(prev => resetPool8Trackers(getSafePool8Trackers(prev)));
      setIsMatchPaused(false);
      setPoolBreakEnabled(false);
      return;
    }

    if (isPool15FreeGame(gameSettings?.category)) {
      setPool8FreeSetWinnerIndex(null);
      setIsMatchPaused(false);
      return;
    }

    onSwitchPoolBreakPlayerIndex(poolBreakPlayerIndex, playerIndex => {
      setCurrentPlayerIndex(playerIndex);
    });
  }, [
    poolBreakPlayerIndex,
    gameSettings,
    playerSettings,
    onSwitchPoolBreakPlayerIndex,
  ]);

  const getLatestReplaySegmentPath = async () => {
    try {
      const historyFiles = await listPlayableFiles(webcamFolderName, true);
      const latestHistoryPath = historyFiles[historyFiles.length - 1]?.path;

      if (latestHistoryPath) {
        console.log('[HistoryRecorder]', {
          event: 'latest-history-segment-selected',
          outputPath: latestHistoryPath,
          source: 'HistoryOnly',
          reason: 'end-match must not depend on replay temp clips',
        });
        return latestHistoryPath;
      }

      const replayFiles = await listReplayFiles(webcamFolderName);
      if (!replayFiles.length) {
        return undefined;
      }

      return replayFiles[replayFiles.length - 1]?.path;
    } catch (error) {
      console.log('[Replay] Failed to get latest replay/history segment:', error);
      return undefined;
    }
  };

  const startVideoRecording = () => {
    if (!cameraRef.current) {
      console.log('[Replay] skip start: cameraRef null');
      return false;
    }

    if (isRecordingRef.current) {
      console.log('[Replay] skip start: already recording');
      return true;
    }

    if (isStoppingRecordingRef.current) {
      console.log('[Replay] skip start: stopping in progress');
      return false;
    }

    try {
      restartAfterStopRef.current = false;
      isStoppingRecordingRef.current = false;
      lastRecordedVideoPathRef.current = undefined;
      isRecordingRef.current = true;
      setIsRecording(true);

      recordingFinishedPromiseRef.current = new Promise(resolve => {
        recordingFinishedResolverRef.current = resolve;
      });

      if (recordingRotateTimeoutRef.current) {
        clearTimeout(recordingRotateTimeoutRef.current);
      }

      currentReplaySegmentIndexRef.current = replayCompletedSegmentsRef.current;
      currentReplaySegmentStartTotalTimeRef.current = totalTimeRef.current;
      currentReplaySegmentWallStartMsRef.current = Date.now();
      replayTimelineSignatureRef.current = '';
      lastReplayTimelineWriteSignatureRef.current = '';

      console.log('Starting recording...');
      cameraRef.current.startRecording({
        webcamFolderName,
        segmentIndex: currentReplaySegmentIndexRef.current,
        fileType: 'mp4',
        videoCodec: 'h264',
        onRecordingFinished: async video => {
          console.log('Recording finished:', video?.path);

          if (recordingRotateTimeoutRef.current) {
            clearTimeout(recordingRotateTimeoutRef.current);
            recordingRotateTimeoutRef.current = null;
          }

          let finalPath = video?.path;

          try {
            if (video?.path) {
              if (ENABLE_SEGMENT_OVERLAY_BURN && finalPath) {
                // Bật lại chỉ khi thực sự cần file replay có overlay cứng trong video.
                // Mặc định tắt để ưu tiên độ mượt và tránh spike FFmpeg sau mỗi segment.
              }

              const registeringSegmentIndex = currentReplaySegmentIndexRef.current;
              const nativeDurationSeconds = Number((video as any)?.durationSeconds || 0);
              const wallDurationSeconds = Math.max(
                0,
                (Date.now() - Math.max(0, currentReplaySegmentWallStartMsRef.current || Date.now())) / 1000,
              );
              const matchClockDurationSeconds = Math.max(
                0,
                totalTimeRef.current - currentReplaySegmentStartTotalTimeRef.current,
              );
              const resolvedDurationSeconds = Math.max(
                nativeDurationSeconds,
                wallDurationSeconds,
                matchClockDurationSeconds,
              );
              const resolvedSegmentStartedAt = Number((video as any)?.nativeStartResolvedAtMs || 0) ||
                currentReplaySegmentWallStartMsRef.current ||
                Date.now() - resolvedDurationSeconds * 1000;

              console.log('[SegmentLifecycle]', {
                event: 'registerFromGameplay',
                segmentIndex: registeringSegmentIndex,
                path: video.path,
                nativeDurationSeconds,
                wallDurationSeconds,
                matchClockDurationSeconds,
                resolvedDurationSeconds,
                segmentStartedAt: resolvedSegmentStartedAt,
              });

              const registeredPath = await registerReplaySegment(
                webcamFolderName,
                video.path,
                {
                  keepFullMatch: true,
                  matchSessionId: matchSessionIdRef.current,
                  segmentIndex: registeringSegmentIndex,
                  mode: gameSettings?.category,
                  playerNames: playerSettings?.playingPlayers?.map(player => String(player?.name || '')).filter(Boolean) as string[],
                  segmentStartedAt: resolvedSegmentStartedAt,
                  durationSeconds: resolvedDurationSeconds,
                },
              );

              if (!registeredPath) {
                console.log('[Replay] invalid segment skipped:', finalPath);
                finalPath = undefined;
              } else {
                finalPath = registeredPath;
                replayCompletedSegmentsRef.current = Math.max(
                  replayCompletedSegmentsRef.current,
                  registeringSegmentIndex + 1,
                );

                const completedSegments = replayCompletedSegmentsRef.current;
                if (
                  completedSegments - lastPruneCompletedSegmentsRef.current >=
                  REPLAY_PRUNE_EVERY_N_SEGMENTS
                ) {
                  lastPruneCompletedSegmentsRef.current = completedSegments;
                  setTimeout(() => {
                    void pruneReplayStorage(MAX_REPLAY_STORAGE_BYTES, [webcamFolderName]).catch(
                      error => {
                        console.log('[Replay] deferred prune failed:', error);
                      },
                    );
                  }, 1500);
                }
              }
            }
          } catch (segmentError) {
            console.error('Failed to register replay segment:', segmentError);
          } finally {
            lastRecordedVideoPathRef.current = finalPath;
            recordingFinishedResolverRef.current?.(finalPath);
            recordingFinishedResolverRef.current = null;
            recordingFinishedPromiseRef.current = null;

            if (restartAfterStopRef.current) {
              restartAfterStopRef.current = false;
              pendingStartRecordingRef.current = true;
            }

            isRecordingRef.current = false;
            setIsRecording(false);
            isStoppingRecordingRef.current = false;
            console.log('[ReplayRecorder]', {
              event: 'segment-registration-finished',
              path: finalPath,
              nextSegmentIndex: replayCompletedSegmentsRef.current,
              restartPending: pendingStartRecordingRef.current,
            });
          }
        },
        onRecordingError: error => {
          console.error('Recording error:', error);
          isRecordingRef.current = false;
          setIsRecording(false);
          isStoppingRecordingRef.current = false;

          if (recordingRotateTimeoutRef.current) {
            clearTimeout(recordingRotateTimeoutRef.current);
            recordingRotateTimeoutRef.current = null;
          }

          recordingFinishedResolverRef.current?.(undefined);
          recordingFinishedResolverRef.current = null;
          recordingFinishedPromiseRef.current = null;
        },
      });

      recordingRotateTimeoutRef.current = setTimeout(async () => {
        if (!isRecordingRef.current || isStoppingRecordingRef.current) {
          return;
        }

        try {
          pendingStartRecordingRef.current = true;
          await stopVideoRecording(true);
        } catch (rotationError) {
          console.error('Failed to rotate recording:', rotationError);
        }
      }, RECORDING_SEGMENT_DURATION_MS);

      return true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      isRecordingRef.current = false;
      isRecordingRef.current = false;
      setIsRecording(false);
      isStoppingRecordingRef.current = false;
      recordingFinishedResolverRef.current?.(undefined);
      recordingFinishedResolverRef.current = null;
      recordingFinishedPromiseRef.current = null;
      return false;
    }
  };

  const stopVideoRecording = async (restartAfterStop = false) => {
    if (recordingRotateTimeoutRef.current) {
      clearTimeout(recordingRotateTimeoutRef.current);
      recordingRotateTimeoutRef.current = null;
    }

    restartAfterStopRef.current = restartAfterStop;

    if (isStoppingRecordingRef.current) {
      console.log('[Replay] skip stop: already stopping');
      return (
        (await Promise.race([
          recordingFinishedPromiseRef.current,
          new Promise<string | undefined>(resolve =>
            setTimeout(() => resolve(undefined), 2500),
          ),
        ])) ??
        lastRecordedVideoPathRef.current ??
        (await getLatestReplaySegmentPath())
      );
    }

    if (!cameraRef.current || !isRecordingRef.current) {
      console.log('[Replay] skip stop: not recording');
      return lastRecordedVideoPathRef.current ?? (await getLatestReplaySegmentPath());
    }

    isStoppingRecordingRef.current = true;
    console.log('Stopping recording...');

    try {
      const waitForFinish =
        recordingFinishedPromiseRef.current ||
        new Promise<string | undefined>(resolve => resolve(undefined));

      await Promise.race([
        cameraRef.current.stopRecording(),
        new Promise(resolve => setTimeout(resolve, 2500)),
      ]);

      let recordedPath = await Promise.race([
        waitForFinish,
        new Promise<string | undefined>(resolve =>
          setTimeout(() => resolve(undefined), 2500),
        ),
      ]);

      if (!recordedPath) {
        await new Promise(resolve => setTimeout(resolve, 700));
        recordedPath =
          lastRecordedVideoPathRef.current ?? (await getLatestReplaySegmentPath());
      }

      if (!recordedPath) {
        console.log('[Replay] stop timeout fallback: release stopping flag');
        isRecordingRef.current = false;
        setIsRecording(false);
        isStoppingRecordingRef.current = false;
        restartAfterStopRef.current = false;
      }

      console.log('[Replay] stopVideoRecording finished with path:', recordedPath);
      return recordedPath;
    } catch (error) {
      console.error('Failed to stop recording:', error);
      isRecordingRef.current = false;
      setIsRecording(false);
      isStoppingRecordingRef.current = false;
      restartAfterStopRef.current = false;
      return lastRecordedVideoPathRef.current ?? (await getLatestReplaySegmentPath());
    }
  };

  const resolveAplusTargetScoreFromSettings = useCallback(() => {
    const rawTarget =
      (gameSettings as any)?.players?.goal?.goal ??
      (gameSettings as any)?.players?.goal ??
      (gameSettings as any)?.goal ??
      (gameSettings as any)?.targetScore ??
      (playerSettings as any)?.goal ??
      (playerSettings as any)?.targetScore ??
      (playerSettings?.playingPlayers?.[0] as any)?.goal ??
      (playerSettings?.playingPlayers?.[1] as any)?.goal ??
      0;

    const num = Number(rawTarget);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }, [gameSettings, playerSettings]);

  const resolveAplusCountdownBaseTimeFromSettings = useCallback(() => {
    const rawBase =
      (gameSettings as any)?.mode?.countdownTime ??
      (gameSettings as any)?.countdownTime ??
      (gameSettings as any)?.countdown?.time ??
      (gameSettings as any)?.timerDuration ??
      countdownTime ??
      40;

    const num = Number(rawBase);
    return Number.isFinite(num) && num > 0 ? num : 40;
  }, [gameSettings, countdownTime]);

  const aplusLiveScoreLastSignatureRef = useRef('');
  const aplusLiveScoreLastPushAtRef = useRef(0);
  const aplusLiveScorePushInFlightRef = useRef(false);
  const aplusLiveScoreWinnerRef = useRef(winner);

  useEffect(() => {
    aplusLiveScoreWinnerRef.current = winner;
  }, [winner]);

  useEffect(() => {
    aplusLiveScoreLastSignatureRef.current = '';
    aplusLiveScoreLastPushAtRef.current = 0;
  }, [
    (gameSettings as any)?.aplusLiveScore?.tournamentId,
    (gameSettings as any)?.aplusLiveScore?.matchId,
    (gameSettings as any)?.aplusLiveScore?.matchNumber,
  ]);

  const pushAplusLiveScoreSnapshot = useCallback(
    async (reason: string, force = false) => {
      if (!gameSettings?.aplusLiveScore?.enabled) {
        return;
      }

      const players = playerSettings?.playingPlayers || [];
      const score1 = Number(players[0]?.totalPoint || 0);
      const score2 = Number(players[1]?.totalPoint || 0);
      const safeCountdownTime = Math.max(0, Math.round(Number(countdownTime ?? 0)));
      const safeCountdownBaseTime = resolveAplusCountdownBaseTimeFromSettings();
      const safeTargetScore = resolveAplusTargetScoreFromSettings();
      const safeTurns = Math.max(0, Math.round(Number(totalTurns ?? 0)));
      const safeTotalTime = Math.max(0, Math.round(Number(totalTime ?? 0)));
      const running = Boolean(isStarted && !isPaused && !isMatchPaused && !winner);

      const signature = [
        gameSettings?.aplusLiveScore?.matchId || '',
        score1,
        score2,
        safeTurns,
        safeTotalTime,
        safeCountdownTime,
        safeCountdownBaseTime,
        safeTargetScore,
        currentPlayerIndex,
        winner ? 'winner' : '',
        isStarted ? 'started' : 'not-started',
        isPaused ? 'paused' : 'not-paused',
        isMatchPaused ? 'match-paused' : 'match-not-paused',
        running ? 'timer-running' : 'timer-stopped',
      ].join('|');

      const now = Date.now();
      const sameAsLast = signature === aplusLiveScoreLastSignatureRef.current;
      const elapsedSinceLastPush = now - aplusLiveScoreLastPushAtRef.current;

      // Không gửi lại cùng một snapshot đã dừng/kết thúc. Bản cũ force 350ms
      // vẫn bắn PATCH liên tục kể cả status=finished, nên khi đổi T3 -> T6
      // trạng thái cũ bị đẩy lặp vào trận mới.
      if (sameAsLast && !running) {
        return;
      }

      // Khi đang chạy countdown, chỉ gửi correction định kỳ.
      // Điểm/lượt/state vẫn đẩy ngay qua state-change-fast; còn snapshot giống hệt thì không được spam API.
      if (sameAsLast && elapsedSinceLastPush < 4500) {
        return;
      }

      if (!force && sameAsLast) {
        return;
      }

      // Không chặn ở ViewModel nữa. Service layer có latest-only queue theo matchId,
      // nên nếu API đang chậm thì snapshot mới nhất sẽ thay snapshot cũ và được gửi tiếp.
      aplusLiveScoreLastSignatureRef.current = signature;
      aplusLiveScoreLastPushAtRef.current = now;
      aplusLiveScorePushInFlightRef.current = true;

      try {
        const result = await pushAplusLiveScoreUpdate({
          gameSettings,
          playerSettings,
          totalTurns: safeTurns,
          totalTime: safeTotalTime,
          countdownTime: safeCountdownTime,
          countdownBaseTime: safeCountdownBaseTime,
          targetScore: safeTargetScore,
          currentPlayerIndex,
          winner,
          isStarted,
          isPaused,
          isMatchPaused,
        });

        if (!(result as any)?.replacedByNewerSnapshot) {
          console.log('[AplusLiveScore] push ok:', {
            reason,
            score1,
            score2,
            turnCount: safeTurns,
            countdownTime: safeCountdownTime,
            countdownBaseTime: safeCountdownBaseTime,
            targetScore: safeTargetScore,
            running,
          });
        }
      } catch (error: any) {
        console.log('[AplusLiveScore] push failed:', error?.message || error);
      } finally {
        aplusLiveScorePushInFlightRef.current = false;
      }
    },
    [
      gameSettings,
      playerSettings,
      totalTurns,
      totalTime,
      countdownTime,
      currentPlayerIndex,
      winner,
      isStarted,
      isEndingGame,
      isPaused,
      isMatchPaused,
      resolveAplusCountdownBaseTimeFromSettings,
      resolveAplusTargetScoreFromSettings,
    ],
  );

  // Push ngay khi điểm/lượt/timer thay đổi, giảm độ trễ so với debounce cũ.
  useEffect(() => {
    const timeout = setTimeout(() => {
      void pushAplusLiveScoreSnapshot('state-change-fast', false);
    }, 250);

    return () => clearTimeout(timeout);
  }, [pushAplusLiveScoreSnapshot]);

  // Push correction định kỳ để web giữ countdown/lock đồng bộ nhưng không spam API.
  // Điểm số vẫn được đẩy gần như ngay lập tức bằng effect state-change-fast phía trên.
  useEffect(() => {
    if (!gameSettings?.aplusLiveScore?.enabled) {
      return;
    }

    const timer = setInterval(() => {
      void pushAplusLiveScoreSnapshot('periodic-safe-sync', true);
    }, 8000);

    return () => clearInterval(timer);
  }, [
    gameSettings?.aplusLiveScore?.enabled,
    pushAplusLiveScoreSnapshot,
  ]);

  // Heartbeat riêng để giữ live session/lock sống trong lúc điểm không đổi hoặc API score đang throttle.
  // Heartbeat không thay đổi điểm và không được dùng để finish trận.
  useEffect(() => {
    const liveConfig = (gameSettings as any)?.aplusLiveScore;
    if (!liveConfig?.enabled || !liveConfig?.matchId || winner) {
      return;
    }

    const sendHeartbeat = () => {
      void heartbeatAplusLiveScoreMatch(liveConfig).catch((error: any) => {
        console.log('[AplusLiveScore] heartbeat failed:', error?.message || error);
      });
    };

    sendHeartbeat();
    const timer = setInterval(sendHeartbeat, 20000);
    return () => clearInterval(timer);
  }, [
    (gameSettings as any)?.aplusLiveScore?.enabled,
    (gameSettings as any)?.aplusLiveScore?.matchId,
    (gameSettings as any)?.aplusLiveScore?.sessionToken,
    winner,
  ]);


  useEffect(() => {
    const liveConfig = (gameSettings as any)?.aplusLiveScore;
    if (!liveConfig?.enabled) return;
    void bootstrapAplusLiveScoreOutbox('gameplay-open');
  }, [
    (gameSettings as any)?.aplusLiveScore?.enabled,
    (gameSettings as any)?.aplusLiveScore?.matchId,
  ]);

  useEffect(() => {
    const liveConfig = (gameSettings as any)?.aplusLiveScore;
    if (!liveConfig?.enabled || !liveConfig?.matchId) return undefined;

    return () => {
      // Rời gameplay / đổi trận: release live lock để máy khác không bị kẹt phiên.
      // Nếu đã có winner thì /finish là nguồn sự thật, không gọi release kéo trận về released.
      if (!aplusLiveScoreWinnerRef.current) {
        void releaseAplusLiveScoreMatch(liveConfig).catch((error: any) => {
          console.log('[AplusLiveScore] release failed:', error?.message || error);
        });
      }
    };
  }, [
    (gameSettings as any)?.aplusLiveScore?.enabled,
    (gameSettings as any)?.aplusLiveScore?.matchId,
    (gameSettings as any)?.aplusLiveScore?.sessionToken,
  ]);

  return useMemo(() => {

    return {
      matchCountdownRef,
      winner,
      currentPlayerIndex,
      poolBreakPlayerIndex,
      totalTime,
      totalTurns,
      playerSettings,
      gameSettings,
      countdownTime,
      warmUpCount,
      warmUpCountdownTime,
      updateGameSettings,
      isStarted,
      isEndingGame,
      isPaused,
      isMatchPaused,
      soundEnabled,
      gameBreakEnabled,
      poolBreakEnabled,
      proModeEnabled,
      webcamFolderName,
      onEditPlayerName,
      onChangePlayerPoint,
      onPressGiveMoreTime,
      onViolate,
      getWarmUpTimeString,
      onGameBreak,
      onWarmUp,
      onEndWarmUp,
      onQuickMatchWarmUpNext,
      onSwitchTurn,
      onSwitchPoolBreakPlayerIndex,
      onSwapPlayers,
      onIncreaseTotalTurns,
      onDecreaseTotalTurns,
      onToggleSound,
      onToggleProMode,
      updateWebcamFolderName,
      onPool15OnlyScore,
      onPoolScore,
      pool8Trackers,
      pool8SetWinnerIndex,
      onSwapPool8Groups,
      onPressPool8Ball,
      pool8FreeHole10Scores,
      pool8FreeSetWinnerIndex,
      onIncrementPool8FreeHole10,
      onDecrementPool8FreeHole10,
      onSelectWinner,
      onClearWinner,
      onCloseWinnerSummary,
      onPoolBreak,
      onStart,
      onEndTurn,
      onToggleCountDown,
      onPause,
      onReplay,
      onStop,
      onReset,
      onResetTurn,
      youtubeLiveOverlay,
      youtubeLivePreviewActive,
      dismissYouTubeLiveOverlay,
      openYouTubeLiveLogin,
      cameraRef,
      setIsCameraReady,
      isCameraReady,
      isRecording,
      cameraSessionNonce,
    language,
      //isPreview,
      //setIsPreview,
      //pauseVideoRecording,
      //resumeVideoRecording,
      // stopVideoRecording,
      // videoUri,
      // setVideoUri
    };
  }, [
    matchCountdownRef,
    winner,
    currentPlayerIndex,
    poolBreakPlayerIndex,
    totalTime,
    totalTurns,
    playerSettings,
    gameSettings,
    countdownTime,
    warmUpCount,
    warmUpCountdownTime,
    updateGameSettings,
    isStarted,
    isEndingGame,
    isPaused,
    isMatchPaused,
    soundEnabled,
    gameBreakEnabled,
    poolBreakEnabled,
    proModeEnabled,
    webcamFolderName,
    onEditPlayerName,
    onChangePlayerPoint,
    onPressGiveMoreTime,
    onViolate,
    getWarmUpTimeString,
    onGameBreak,
    onWarmUp,
    onEndWarmUp,
    onQuickMatchWarmUpNext,
    onSwitchTurn,
    onSwitchPoolBreakPlayerIndex,
    onSwapPlayers,
    onIncreaseTotalTurns,
    onDecreaseTotalTurns,
    onToggleSound,
    onToggleProMode,
    updateWebcamFolderName,
    onPool15OnlyScore,
    onPoolScore,
    pool8Trackers,
    pool8SetWinnerIndex,
    onSwapPool8Groups,
    onPressPool8Ball,
    pool8FreeHole10Scores,
    pool8FreeSetWinnerIndex,
    onIncrementPool8FreeHole10,
    onDecrementPool8FreeHole10,
    onSelectWinner,
    onClearWinner,
    onCloseWinnerSummary,
    onPoolBreak,
    onStart,
    onEndTurn,
    onToggleCountDown,
    onPause,
    onReplay,
    onStop,
    onReset,
    onResetTurn,
    youtubeLiveOverlay,
    youtubeLivePreviewActive,
    dismissYouTubeLiveOverlay,
    openYouTubeLiveLogin,
    cameraRef,
    isPaused,
    setIsCameraReady,
    isCameraReady,
    isRecording,
    cameraSessionNonce,
    language,
    // isPreview,
    // setIsPreview,
    // videoUri,
    // setVideoUri
    //pauseVideoRecording,
    // videoUri,
    //resumeVideoRecording,
    //stopVideoRecording,
  ]);
};

export default GamePlayViewModel;
