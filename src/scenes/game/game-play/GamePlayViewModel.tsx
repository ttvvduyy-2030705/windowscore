import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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

let countdownInterval: NodeJS.Timeout, warmUpCountdownInterval: NodeJS.Timeout;
const {CameraService} = NativeModules;

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

const resetPool8Trackers = (trackers: Pool8Tracker[]): Pool8Tracker[] =>
  trackers.map(tracker => ({...tracker, activeIndex: 0}));

const REPLAY_RESUME_SNAPSHOT_STORAGE_KEY =
  '@APLUS_REPLAY_RESUME_SNAPSHOT_V3';

const LIVE_MATCH_SNAPSHOT_STORAGE_KEY = '@APLUS_LIVE_MATCH_SNAPSHOT_V1';

type LiveMatchSnapshot = ReplayResumeSnapshot & {
  configSignature?: string;
};

const buildGameSettingsSignature = (settings: any) => {
  try {
    return JSON.stringify({
      category: settings?.category ?? null,
      mode: settings?.mode ?? null,
      playerNumber: settings?.players?.playerNumber ?? null,
      goal: settings?.players?.goal?.goal ?? null,
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
) => {
  if (!snapshot?.playerSettings) {
    return false;
  }

  if (snapshot.savedAt && Date.now() - snapshot.savedAt > 6 * 60 * 60 * 1000) {
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

const deriveWinnerNameFromScore = (
  settings?: PlayerSettings | null,
  finalScore?: number[],
) => {
  const players = Array.isArray(settings?.playingPlayers)
    ? settings!.playingPlayers
    : [];

  if (!players.length || !Array.isArray(finalScore) || !finalScore.length) {
    return undefined;
  }

  let winnerIndex = 0;
  let winnerScore = Number(finalScore[0] || 0);

  finalScore.forEach((score, index) => {
    if (Number(score || 0) > winnerScore) {
      winnerIndex = index;
      winnerScore = Number(score || 0);
    }
  });

  return players[winnerIndex]?.name;
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
) => {
  if (!isReplayResumeSnapshotReusable(snapshot)) {
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
  const gameSettingsSignature = useMemo(() => {
    return buildGameSettingsSignature(gameSettings);
  }, [
    gameSettings?.category,
    gameSettings?.mode,
    gameSettings?.players?.playerNumber,
    gameSettings?.players?.goal?.goal,
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
  const appliedReplayResumeSnapshotRef = useRef(false);
  const initializedGameStateRef = useRef(false);
  const matchSessionIdRef = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
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
          title: 'Live YouTube lỗi',
          message: event.message,
          checks: [],
        });
      }
    });

    return () => {
      unsubscribe();
      void stopYouTubeNativeLive();
    };
  }, []);



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

  const now =
    gameSettings?.webcamFolderName != null
      ? gameSettings?.webcamFolderName
      : Date.now().toString();

  const [webcamFolderName, setWebcamFolderName] = useState<string>(now);

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

    if (!activeMatchFolderNameRef.current) {
      activeMatchFolderNameRef.current = webcamFolderName;
      console.log('[MatchSession]', {
        event: 'createMatchId',
        activeMatchId: matchSessionIdRef.current,
        webcamFolderName,
        reasonIfCreateNew: 'initial gameplay session folder',
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
            title: 'Live YouTube lỗi',
            message: error?.message || 'Không thể bắt đầu live YouTube.',
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
  !isPoolGame(gameSettings?.category) && gameSettings?.mode?.mode !== 'fast',
);

  const applyReplayResumeSnapshot = useCallback((snapshot: ReplayResumeSnapshot) => {
    clearInterval(countdownInterval);
    clearInterval(warmUpCountdownInterval);

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

    appliedReplayResumeSnapshotRef.current = true;
    initializedGameStateRef.current = true;
  }, []);

  const tryRestoreReplayResumeSnapshot = useCallback(async () => {
    const snapshot = await getReplayResumeSnapshot();
    const returnRequest = getReplayReturnRequestSync();
    const expectedFolderName = webcamFolderName || gameSettings?.webcamFolderName;
    const expectedMatchSessionId =
      returnRequest?.matchSessionId || matchSessionIdRef.current;

    const shouldForceRestore = Boolean(
      returnRequest &&
        snapshot &&
        isReplayResumeSnapshotReusable(snapshot) &&
        ((returnRequest.matchSessionId &&
          snapshot.matchSessionId === returnRequest.matchSessionId) ||
          (returnRequest.webcamFolderName &&
            snapshot.webcamFolderName === returnRequest.webcamFolderName)),
    );

    if (
      !shouldForceRestore &&
      !snapshot?.restoreOnNextFocus
    ) {
      return false;
    }

    if (
      !shouldForceRestore &&
      !isReplayResumeSnapshotMatch(
        snapshot,
        expectedFolderName,
        expectedMatchSessionId,
      )
    ) {
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
      restoreOnNextFocus: false,
    });

    return true;
  }, [applyReplayResumeSnapshot, gameSettings?.webcamFolderName, webcamFolderName]);

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
    };
  }, [
    countdownTime,
    currentPlayerIndex,
    gameBreakEnabled,
    gameSettingsSignature,
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

    if (!isLiveMatchSnapshotUsable(snapshot, gameSettingsSignature)) {
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
  }, [applyReplayResumeSnapshot, gameSettingsSignature, youtubeLiveNativeMode]);

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
  }, [buildLiveMatchSnapshot]);

  // useEffect(() => {
  //      if(!hasPermission){
  //        requestPermission()
  //      }
  // }, [hasPermission]);

  useEffect(() => {
    remoteHandlersRef.current = {
      start: isStarted ? onPause : onStart,
      warmUp: warmUpCountdownTime ? onEndWarmUp : onWarmUp,
      stop: onToggleCountDown,
      gameBreak: onPoolBreak,
      extension: onPressGiveMoreTime,
      timer: onResetTurn,
      newGame: onReset,
      up: () => onChangePlayerPoint(1, currentPlayerIndex, 0),
      down: () => onChangePlayerPoint(-1, currentPlayerIndex, 0),
      left: onEndTurn,
      right: onEndTurn,
    };
  }, [
    isStarted,
    warmUpCountdownTime,
    onPause,
    onStart,
    onEndWarmUp,
    onWarmUp,
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
      if (cancelled || initializedGameStateRef.current) {
        return;
      }

      appliedReplayResumeSnapshotRef.current = false;
      initializedGameStateRef.current = true;

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
  }, [gameSettings, tryRestoreLiveMatchSnapshot, tryRestoreReplayResumeSnapshot]);

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

  const showWinnerAlertAndGoBack = useCallback((winnerPlayer?: Player) => {
    if (!winnerPlayer?.name || winnerAlertShownRef.current) {
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
          },
        },
      ],
      {cancelable: false},
    );
  }, [navigation]);

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
      const nextTotalPoint = Number(player?.totalPoint || 0) + addedPoint;
      const winnerPlayer =
        player && nextTotalPoint >= Number(gameSettings.players.goal.goal || 0)
          ? ({
              ...player,
              totalPoint: nextTotalPoint,
              proMode: {
                ...player.proMode,
                currentPoint: Number(player.proMode?.currentPoint || 0) + addedPoint,
              },
            } as Player)
          : undefined;

      setPlayerSettings(
        prev =>
          ({
            ...prev,
            playingPlayers: prev?.playingPlayers.map((currentPlayer, playerIndex) => {
              if (index === playerIndex) {
                return {
                  ...currentPlayer,
                  totalPoint: currentPlayer.totalPoint + addedPoint,
                  proMode: {
                    ...currentPlayer.proMode,
                    currentPoint:
                      (currentPlayer.proMode?.currentPoint || 0) + addedPoint,
                  },
                };
              }

              return currentPlayer;
            }),
          } as PlayerSettings),
      );

      if (winnerPlayer) {
        setWinner(winnerPlayer);
        setIsStarted(false);
        setIsPaused(false);
        setIsMatchPaused(true);
        showWinnerAlertAndGoBack(winnerPlayer);
        return;
      }

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
      showWinnerAlertAndGoBack,
    ],
  );

  const onPressGiveMoreTime = useCallback(() => {
    const baseCountdown = Number(gameSettings?.mode?.countdownTime || 0);
    const configuredBonus = Number(gameSettings?.mode?.extraTimeBonus || 0);
    const currentPlayer = playerSettings?.playingPlayers?.[currentPlayerIndex];
    const remainingTurns = currentPlayer?.proMode?.extraTimeTurns;

    console.log('[Extension] press', {
      isStarted,
      baseCountdown,
      configuredBonus,
      currentCountdown: countdownTime,
      currentPlayerIndex,
      remainingTurns,
    });

    if (!isStarted || !playerSettings || !baseCountdown) {
      console.log('[Extension] blocked: invalid state');
      return;
    }

    if (typeof remainingTurns === 'number' && remainingTurns <= 0) {
      console.log('[Extension] blocked: no extra turns left');
      return;
    }

    const appliedBonus =
      configuredBonus > 0
        ? configuredBonus
        : baseCountdown > 0
          ? baseCountdown
          : 35;

    setCountdownTime(prev => {
      const safePrev = Number.isFinite(prev) ? prev : baseCountdown;
      const next = safePrev + appliedBonus;
      console.log('[Extension] countdown update', {safePrev, appliedBonus, next});
      return next;
    });

    setIsMatchPaused(false);

    setPlayerSettings(prev => {
      if (!prev?.playingPlayers?.length) {
        return prev;
      }

      const playingPlayers = prev.playingPlayers.map((player, index) => {
        if (index !== currentPlayerIndex || !player.proMode) {
          return player;
        }

        if (typeof player.proMode.extraTimeTurns !== 'number') {
          return player;
        }

        return {
          ...player,
          proMode: {
            ...player.proMode,
            extraTimeTurns: Math.max(0, player.proMode.extraTimeTurns - 1),
          },
        } as Player;
      });

      return {
        ...prev,
        playingPlayers,
      } as PlayerSettings;
    });
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
      const opponentScoreAfter = isThreeFoulPenalty
        ? opponentScoreBefore + 1
        : opponentScoreBefore;
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
                ? Number(player.totalPoint || 0) + 1
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
          resetPool8Trackers(prev.length ? prev : buildDefaultPool8Trackers()),
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

      const winnerPlayer = playerSettings.playingPlayers[playerIndex];
      const announcedWinnerPlayer = addMatchPoint
        ? ({...winnerPlayer, totalPoint: Number(winnerPlayer.totalPoint || 0) + 1} as Player)
        : winnerPlayer;

      setWinner(announcedWinnerPlayer);
      setIsStarted(false);
      setIsPaused(false);
      setIsMatchPaused(true);

      if (addMatchPoint) {
        setPlayerSettings(
          prev =>
            ({
              ...prev,
              playingPlayers: prev?.playingPlayers.map((player, currentIndex) => {
                if (playerIndex === currentIndex) {
                  return {...player, totalPoint: player.totalPoint + 1};
                }

                return player;
              }),
            } as PlayerSettings),
        );
      }

      showWinnerAlertAndGoBack(announcedWinnerPlayer);
    },
    [playerSettings, showWinnerAlertAndGoBack],
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

      const nextPoint = Math.min(8, Number(targetPlayer.totalPoint || 0) + 1);
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
        const winnerPlayer = newPlayingPlayers[playerIndex];
        setWinner(winnerPlayer);
        setIsStarted(false);
        setIsPaused(false);
        setIsMatchPaused(true);
        showWinnerAlertAndGoBack(winnerPlayer);
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
      const next = prev.length >= 2 ? [...prev] : buildDefaultPool8Trackers();
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
        const updatedPlayers = playerSettings.playingPlayers.map((player, index) =>
          index === playerIndex
            ? ({
                ...player,
                totalPoint: Number(player.totalPoint || 0) + 1,
              } as Player)
            : player,
        );

        setPlayerSettings({...playerSettings, playingPlayers: updatedPlayers});
        setPool8SetWinnerIndex(playerIndex);
        setIsMatchPaused(true);

        const setWinnerPlayer = updatedPlayers[playerIndex];
        const targetGoal = Number(gameSettings?.players?.goal?.goal || 0);

        if (Number(setWinnerPlayer?.totalPoint || 0) >= targetGoal && targetGoal > 0) {
          setWinner(setWinnerPlayer);
          setIsStarted(false);
          setIsPaused(false);
          showWinnerAlertAndGoBack(setWinnerPlayer);
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
          const updatedPlayers = newPlayingPlayers.map((player, index) =>
            index === currentPlayerIndex
              ? ({
                  ...player,
                  totalPoint: Number(player.totalPoint || 0) + 1,
                } as Player)
              : player,
          );

          setPlayerSettings({...playerSettings, playingPlayers: updatedPlayers});
          setPool8FreeSetWinnerIndex(currentPlayerIndex);
          setIsMatchPaused(true);

          const setWinnerPlayer = updatedPlayers[currentPlayerIndex];
          const targetGoal = Number(gameSettings?.players?.goal?.goal || 0);
          if (Number(setWinnerPlayer?.totalPoint || 0) >= targetGoal && targetGoal > 0) {
            setWinner(setWinnerPlayer);
            setIsStarted(false);
            setIsPaused(false);
            showWinnerAlertAndGoBack(setWinnerPlayer);
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
      !gameSettings ||
      !gameSettings.mode?.countdownTime
    ) {
      return;
    }
    const extraTimeBonus = gameSettings.mode?.extraTimeBonus || 0;
    setCountdownTime(gameSettings.mode?.countdownTime! + extraTimeBonus);
    setPoolBreakEnabled(false);
    setIsMatchPaused(false);
    setIsStarted(true);

    if (isPool15OnlyGame(gameSettings?.category)) {
      setPool8Trackers(prev => resetPool8Trackers(prev.length ? prev : buildDefaultPool8Trackers()));
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
      (typeof warmUpCount === 'number' && warmUpCount <= 0)
    ) {
      return;
    }

    setWarmUpCount(prev => (prev ? prev - 1 : 0));
    setWarmUpCountdownTime(gameSettings?.mode?.warmUpTime);
  }, [gameSettings, warmUpCount]);

  const onGameBreak = useCallback(() => {
    setGameBreakEnabled(true);
    setWarmUpCountdownTime(1);
  }, []);

  const onEndWarmUp = useCallback(() => {
    setWarmUpCountdownTime(undefined);
    setGameBreakEnabled(false);
    clearInterval(warmUpCountdownInterval);
  }, []);

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
                const highestRate = Math.max(
                  Number(player.proMode?.highestRate || 0),
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
    navigate(screens.livePlatformSetupYoutube);
  }, []);

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
        label: 'Tối thiểu 50 người đăng ký',
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
            ? `Kênh hiện có ${subscriberCount} người đăng ký.`
            : hiddenSubscriberCount
            ? 'Không đọc được số người đăng ký vì kênh đang ẩn số người đăng ký.'
            : 'Không đọc được số người đăng ký của kênh.',
      };

      const liveEnabledCheck: YouTubeEligibilityCheck = {
        key: 'liveEnabled',
        label: 'Phát trực tiếp đã bật',
        status:
          liveEnabled === true ? 'pass' : liveEnabled === false ? 'fail' : 'unknown',
        detail:
          liveEnabled === true
            ? 'Kênh hiện có thể dùng tính năng phát trực tiếp.'
            : liveEnabled === false
            ? liveEnabledReason || 'YouTube báo kênh hiện chưa được bật quyền livestream.'
            : 'Chưa xác định được trạng thái phát trực tiếp từ YouTube.',
      };

      return {
        visible: true,
        title: 'Chưa thể live YouTube',
        message:
          fallbackMessage ||
          eligibility?.message ||
          'Để live YouTube, kênh cần từ 50 người đăng ký và tính năng Phát trực tiếp phải dùng được.',
        checks: [subscriberCheck, liveEnabledCheck],
      };
    },
    [],
  );

  const showYouTubeLiveFailure = useCallback(
    (
      eligibility: YouTubeEligibilityResponse | null,
      fallbackMessage?: string,
    ) => {
      const overlayState = buildYouTubeLiveOverlay(eligibility, fallbackMessage);
      setYoutubeLiveOverlay(overlayState);
    },
    [buildYouTubeLiveOverlay],
  );


  const onStart = useCallback(async () => {
    if (isStarted) {
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
        'Chưa nhận được webcam USB',
        'App chưa thấy webcam ngoài. Hãy kiểm tra OTG/nguồn và cắm lại webcam rồi thử lại.',
      );
      return;
    }

    if (!lockedLiveSource) {
      Alert.alert(
        'Không tìm thấy camera',
        'Thiết bị hiện không có nguồn camera phù hợp để bắt đầu live.',
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
      shouldStartRecordingRef.current = true;
      pendingStartRecordingRef.current = true;
      setIsStarted(true);
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
        title: 'Live YouTube chưa sẵn sàng',
        message:
          'Thiếu native YouTube live module hoặc preview view manager. Hãy rebuild APK sau khi đăng ký YouTubeLiveModulePackage và YouTubeLivePreviewViewPackage trong MainApplication.',
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
          description: `Live score từ trận đấu ${firstPlayerName} vs ${secondPlayerName}`,
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
          'Không thể khởi tạo live YouTube.';

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
              'Không thể kiểm tra điều kiện YouTube.',
          );
        }
      }
    };

    void prepareYouTubeLive();
  }, [
    isStarted,
    playerSettings,
    readYouTubeVisibilityFromStorage,
    saveToDeviceWhileStreaming,
    routeParams.livestreamPlatform,
    selectedLivestreamPlatform,
    shouldUseLocalRecordingOnly,
    shouldUseYouTubeLive,
    showYouTubeLiveFailure,
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
        Alert.alert(i18n.t('txtwarn'), 'Video xem lại chưa sẵn sàng. Hãy chờ 1 chút rồi mở lại.');
        return;
      }

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
        playerSettings: cloneReplayValue(playerSettings),
        winner: cloneReplayValue(winner),
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
      Alert.alert(i18n.t('txtError'), 'Không mở được replay. Hãy thử lại sau vài giây.');
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
  Alert.alert(i18n.t('stop'), i18n.t('msgStopGame'), [
    {
      text: i18n.t('txtCancel'),
      style: 'cancel',
    },
    {
      text: i18n.t('stop'),
      onPress: async () => {
        if (isEndingGameRef.current) {
          return;
        }

        isEndingGameRef.current = true;

        try {
          void setReplayResumeSnapshot(null);
          void setLiveMatchSnapshot(null);
          setReplayReturnRequestSync(null);
          shouldStartRecordingRef.current = false;
          pendingStartRecordingRef.current = false;
          pendingYouTubeNativeStartRef.current = null;
          setYoutubeLivePreparing(false);
          await stopYouTubeNativeLive();

          const activeYouTubeBroadcastId = activeYouTubeBroadcastIdRef.current;
          activeYouTubeBroadcastIdRef.current = '';
          if (activeYouTubeBroadcastId) {
            try {
              await stopYouTubeLiveSession(activeYouTubeBroadcastId);
              console.log('[YouTube Live] stopped broadcast:', activeYouTubeBroadcastId);
            } catch (youtubeStopError) {
              console.log('[YouTube Live] stop broadcast failed:', youtubeStopError);
            }
          }

          setYoutubeLivePreviewActive(false);
          setIsCameraReady(false);

          const recordedPath =
            (await stopVideoRecording(false)) ??
            (await getLatestReplaySegmentPath());

          console.log('[Replay] recorded path before endGame:', recordedPath);

          if (!recordedPath) {
            isEndingGameRef.current = false;

            Alert.alert(
              i18n.t('txtwarn'),
              totalTime > 0
                ? 'Video chưa khả dụng. Bạn có muốn thoát trận và không lưu video xem lại không?'
                : 'Bạn chưa bắt đầu quay. Bạn có muốn thoát trận luôn không?',
              [
                {
                  text: i18n.t('txtCancel'),
                  style: 'cancel',
                },
                {
                  text: 'Thoát không lưu',
                  style: 'destructive',
                  onPress: () => {
                    goBack();
                  },
                },
              ],
            );

            return;
          }

          await flushReplayScoreboardTimeline(webcamFolderName);
          const replayTimeline = await loadReplayScoreboardTimeline(webcamFolderName);
          const overlayLastSnapshot = replayTimeline?.entries?.length
            ? replayTimeline.entries[replayTimeline.entries.length - 1]
            : undefined;
          const overlayLastSettings = overlayLastSnapshot?.playerSettings as
            | PlayerSettings
            | undefined;
          const scoreBeforeFinalize = getFinalScoreSnapshot(playerSettings);
          const latestStatePlayerSettings = playerSettingsRef.current || playerSettings;
          const latestStateScore = getFinalScoreSnapshot(latestStatePlayerSettings);
          const overlayLastSnapshotScore = getFinalScoreSnapshot(overlayLastSettings);
          const useOverlayAsFinal =
            overlayLastSettings &&
            getScoreSnapshotTotal(overlayLastSnapshotScore) >=
              getScoreSnapshotTotal(latestStateScore);
          const finalPlayerSettings = cloneReplayValue(
            useOverlayAsFinal ? overlayLastSettings : latestStatePlayerSettings,
          );
          const finalCommittedScore = getFinalScoreSnapshot(finalPlayerSettings);
          const finalWinnerName =
            winnerRef.current?.name ||
            deriveWinnerNameFromScore(finalPlayerSettings, finalCommittedScore);
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
              });
            } catch (exportError) {
              console.log('[Replay] export full match failed:', exportError);
            }
          }

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

          goBack();
        } catch (error) {
          isEndingGameRef.current = false;
          console.error(JSON.stringify(error));
        }
      },
    },
  ]);
}, [
  dispatch,
  realm,
  totalTime,
  gameSettings,
  playerSettings,
  saveToDeviceWhileStreaming,
  webcamFolderName,
]);

  const onReset = useCallback(() => {
    pendingNewGameAfterViolateRef.current = false;
    void setReplayResumeSnapshot(null);
    void setLiveMatchSnapshot(null);
    setReplayReturnRequestSync(null);
    const shouldResetRackScore = false;

    const newPlayerSettings = {
      ...playerSettings,
      playingPlayers: playerSettings?.playingPlayers.map(player => ({
        ...player,
        totalPoint: shouldResetRackScore ? 0 : player.totalPoint,
        violate: 0,
        scoredBalls: [],
        proMode: {
          ...player.proMode,
          highestRate: 0,
          average: 0,
          extraTimeTurns: gameSettings?.mode?.extraTimeTurns,
        },
      })),
    } as PlayerSettings;

    setPlayerSettings(newPlayerSettings);
    setWinner(undefined);

    if (
      isPoolGame(gameSettings?.category) &&
      gameSettings?.mode?.countdownTime
    ) {
      const extraTimeBonus = gameSettings.mode?.extraTimeBonus || 0;
      setCountdownTime(gameSettings.mode?.countdownTime! + extraTimeBonus);
      setPoolBreakEnabled(!isPool15FreeGame(gameSettings?.category));
    }

    if (isPool15OnlyGame(gameSettings?.category)) {
      setPool8SetWinnerIndex(null);
      setPool8Trackers(prev => resetPool8Trackers(prev.length ? prev : buildDefaultPool8Trackers()));
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
      const replayFiles = await listReplayFiles(webcamFolderName);
      if (!replayFiles.length) {
        return undefined;
      }

      return replayFiles[replayFiles.length - 1]?.path;
    } catch (error) {
      console.log('[Replay] Failed to get latest replay segment:', error);
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
