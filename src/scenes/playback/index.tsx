import React, {memo, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {
  DeviceEventEmitter,
  Image as RNImage,
  NativeEventEmitter,
  NativeModules,
  Platform,
  ScrollView,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import {showEditor, listFiles, deleteFile} from 'react-native-video-trim';
import Video from 'react-native-video';
import {useSelector} from 'react-redux';

import images from 'assets';
import Button from 'components/Button';
import Container from 'components/Container';
import Image from 'components/Image';
import Loading from 'components/Loading';
import PoolBroadcastScoreboard from 'components/PoolBroadcastScoreboard';
import CaromBroadcastScoreboard from 'components/CaromBroadcastScoreboard';
import Text from 'components/Text';
import View from 'components/View';
import {keys} from 'configuration/keys';
import {WEBCAM_SELECTED_VIDEO_TRACK} from 'constants/webcam';
import {RootState} from 'data/redux/reducers';
import i18n from 'i18n';
import {
  buildReplayFolderPath,
  deleteReplayFolder,
  ensureArchiveFolder,
  normalizeWindowsVideoUri,
  resolveReplayFolder,
} from 'services/replay/localReplay';
import {
  loadReplayScoreboardTimeline,
  type ReplayScoreboardTimelineEntry,
} from 'services/replay/replayTimeline';
import {goBack} from 'utils/navigation';
import {isCaromGame, isPool10Game, isPool15Game, isPool9Game} from 'utils/game';
import {shouldShowMatchOverlay} from 'utils/matchOverlay';

import PlayBackWebcamViewModel, {
  PlayBackWebcamViewModelProps,
} from './PlayBackViewModel';
import createStyles from './styles';
import useDesignSystem from 'theme/useDesignSystem';
import VideoListItem from './videoListItem';
import {LanguageContext} from 'context/language';

const setReplayReturnRequestSync = (
  request:
    | {matchSessionId?: string; webcamFolderName?: string; requestedAt?: number}
    | null,
) => {
  (globalThis as any).__APLUS_REPLAY_RETURN_REQUEST__ = request
    ? JSON.parse(JSON.stringify(request))
    : null;
};

const REPLAY_RESUME_SNAPSHOT_STORAGE_KEY = '@APLUS_REPLAY_RESUME_SNAPSHOT_V3';
const PLAYBACK_NATIVE_CONTROLS_BOTTOM_INSET = 100;
const PLAYBACK_RATE_OPTIONS = [1, 1.25, 1.5, 1.75, 2];

type PlaybackThumbnailOverlayState = {
  enabled: boolean;
  topLeft: string[];
  topRight: string[];
  bottomLeft: string[];
  bottomRight: string[];
};

type ReplayOverlaySnapshot = {
  webcamFolderName?: string;
  currentPlayerIndex?: number;
  countdownTime?: number;
  totalTurns?: number;
  playerSettings?: any;
};

const EMPTY_THUMBNAIL_OVERLAY: PlaybackThumbnailOverlayState = {
  enabled: false,
  topLeft: [],
  topRight: [],
  bottomLeft: [],
  bottomRight: [],
};

const formatLocalReplayClipTime = (item: any) => {
  const rawTimestamp = Number(
    item?.createdAtMs ||
      item?.createdAt ||
      (item?.mtime instanceof Date ? item.mtime.getTime() : 0) ||
      (item?.ctime instanceof Date ? item.ctime.getTime() : 0) ||
      0,
  );
  const date = Number.isFinite(rawTimestamp) && rawTimestamp > 0
    ? new Date(rawTimestamp)
    : new Date();
  const formattedLocalTime =
    String(date.getHours()).padStart(2, '0') +
    ':' +
    String(date.getMinutes()).padStart(2, '0');
  const formattedOldWrongTime = date.toISOString().slice(11, 16);

  return {
    rawTimestamp,
    parsedDate: date,
    formattedLocalTime,
    formattedOldWrongTime,
  };
};

const normalizePlaybackVideoUri = (inputPath?: string | null) => {
  const raw = String(inputPath || '').trim();

  if (!raw || Platform.OS !== 'windows') {
    return raw;
  }

  return normalizeWindowsVideoUri(raw);
};

const parseThumbnailUris = (value?: string | null): string[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed.filter(Boolean).slice(0, 1);
    }

    if (typeof parsed === 'string' && parsed.length > 0) {
      return [parsed];
    }

    return [];
  } catch (_error) {
    return [];
  }
};

const getReplayResumeSnapshotSync = (): ReplayOverlaySnapshot | null => {
  const snapshot = (globalThis as any).__APLUS_REPLAY_RESUME_SNAPSHOT__;

  if (!snapshot) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(snapshot));
  } catch (_error) {
    return snapshot;
  }
};

const PlayBackWebcam = (props: PlayBackWebcamViewModelProps) => {
  const {language} = useContext(LanguageContext);
  const viewModel = PlayBackWebcamViewModel(props);
  const {adaptive, design} = useDesignSystem();
  const styles = useMemo(() => createStyles(adaptive, design), [adaptive.styleKey, design]);
  const {gameSettings} = useSelector((state: RootState) => state.game);

  const [folder, setFolder] = useState<string>(
    buildReplayFolderPath(props.webcamFolderName),
  );
  const [thumbnailOverlay, setThumbnailOverlay] =
    useState<PlaybackThumbnailOverlayState>(EMPTY_THUMBNAIL_OVERLAY);
  const [replaySnapshot, setReplaySnapshot] =
    useState<ReplayOverlaySnapshot | null>(null);
  const [scoreboardTimeline, setScoreboardTimeline] =
    useState<ReplayScoreboardTimelineEntry[]>([]);
  const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  const loadThumbnailOverlay = useCallback(async () => {
    try {
      const result = await AsyncStorage.multiGet([
        keys.SHOW_THUMBNAILS_ON_LIVESTREAM,
        keys.THUMBNAILS_TOP_LEFT,
        keys.THUMBNAILS_TOP_RIGHT,
        keys.THUMBNAILS_BOTTOM_LEFT,
        keys.THUMBNAILS_BOTTOM_RIGHT,
      ]);

      const enabledRaw = result?.[0]?.[1];
      const enabled =
        typeof enabledRaw === 'string'
          ? enabledRaw === '1' || enabledRaw.toLowerCase() === 'true'
          : enabledRaw == null
            ? true
            : !!enabledRaw;

      if (!enabled) {
        setThumbnailOverlay(EMPTY_THUMBNAIL_OVERLAY);
        return;
      }

      setThumbnailOverlay({
        enabled: true,
        topLeft: parseThumbnailUris(result?.[1]?.[1]),
        topRight: parseThumbnailUris(result?.[2]?.[1]),
        bottomLeft: parseThumbnailUris(result?.[3]?.[1]),
        bottomRight: parseThumbnailUris(result?.[4]?.[1]),
      });
    } catch (error) {
      console.log('[Playback] load thumbnail overlay error:', error);
      setThumbnailOverlay(EMPTY_THUMBNAIL_OVERLAY);
    }
  }, []);

  const loadReplaySnapshot = useCallback(async () => {
    const runtimeSnapshot = getReplayResumeSnapshotSync();

    if (runtimeSnapshot?.webcamFolderName === props.webcamFolderName) {
      setReplaySnapshot(runtimeSnapshot);
      return;
    }

    try {
      const rawSnapshot = await AsyncStorage.getItem(
        REPLAY_RESUME_SNAPSHOT_STORAGE_KEY,
      );

      if (!rawSnapshot) {
        setReplaySnapshot(null);
        return;
      }

      const parsedSnapshot = JSON.parse(rawSnapshot) as ReplayOverlaySnapshot;
      setReplaySnapshot(
        parsedSnapshot?.webcamFolderName === props.webcamFolderName
          ? parsedSnapshot
          : null,
      );
    } catch (error) {
      console.log('[Playback] load replay snapshot error:', error);
      setReplaySnapshot(null);
    }
  }, [props.webcamFolderName]);

  const loadScoreboardTimeline = useCallback(async () => {
    try {
      const timeline = await loadReplayScoreboardTimeline(props.webcamFolderName);
      const entries = timeline?.entries || [];
      setScoreboardTimeline(entries);
      console.log(props.returnToMatch ? '[ReplayOverlaySync]' : '[HistoryOverlaySync]', {
        event: 'timelineLoadedForPlayback',
        webcamFolderName: props.webcamFolderName,
        overlayTimelineEventsCount: entries.length,
        usingLiveState: false,
      });
    } catch (error) {
      console.log('[Playback] load scoreboard timeline error:', error);
      setScoreboardTimeline([]);
    }
  }, [props.webcamFolderName]);

  useEffect(() => {
    loadScoreboardTimeline();
  }, [loadScoreboardTimeline]);

  useEffect(() => {
    setPlaybackCurrentTime(0);
  }, [viewModel.currentIndex]);

  const cyclePlaybackRate = useCallback(() => {
    setPlaybackRate(currentRate => {
      const currentIndex = PLAYBACK_RATE_OPTIONS.findIndex(rate => rate === currentRate);
      const nextRate =
        PLAYBACK_RATE_OPTIONS[(currentIndex + 1) % PLAYBACK_RATE_OPTIONS.length] || 1;
      const appliedRate = Math.min(2, Math.max(1, nextRate));

      console.log('[PlaybackRate]', {
        requestedRate: nextRate,
        appliedRate,
        maxRate: 2,
        sourceType: props.returnToMatch ? 'replay' : 'history',
        playerSupportsRate: Platform.OS === 'windows',
      });

      return appliedRate;
    });
  }, [props.returnToMatch]);

  useEffect(() => {
    resolveReplayFolder(props.webcamFolderName).then(path => {
      if (path) {
        setFolder(path);
      }
    });
  }, [props.webcamFolderName]);

  useEffect(() => {
    loadThumbnailOverlay();
  }, [loadThumbnailOverlay]);

  useEffect(() => {
    loadReplaySnapshot();
  }, [loadReplaySnapshot]);

  useEffect(() => {
    return () => {
      try {
        viewModel.videoRef.current?.pause?.();
        viewModel.videoRef.current?.stop?.();
        console.log('[VideoPlaybackControl]', {
          action: 'close',
          targetVideoPath: currentVideoPath,
          playerId: playerKey,
          pausedState: true,
          nativePauseCalled: true,
          nativeStopCalled: true,
          audioMuted: true,
          activePlayerCountAfterAction: 0,
        });
        console.log('[SingleActivePlayer]', {
          requestedOpenVideo: null,
          previousPlayerExists: true,
          previousPlayerPaused: true,
          previousPlayerStopped: true,
          previousPlayerUnmounted: true,
          nextPlayerMounted: false,
          activePlayerCount: 0,
        });
      } catch (_error) {
        // ignore cleanup errors
      }
    };
  }, [viewModel.videoRef]);

  const onBackToMatch = async () => {
    try {
      viewModel.videoRef.current?.pause?.();
      viewModel.videoRef.current?.stop?.();
      console.log('[VideoPlaybackControl]', {
        action: 'close',
        targetVideoPath: currentVideoPath,
        playerId: playerKey,
        pausedState: true,
        nativePauseCalled: true,
        nativeStopCalled: true,
        audioMuted: true,
        activePlayerCountAfterAction: 0,
      });
      console.log('[SingleActivePlayer]', {
        requestedOpenVideo: null,
        previousPlayerExists: true,
        previousPlayerPaused: true,
        previousPlayerStopped: true,
        previousPlayerUnmounted: true,
        nextPlayerMounted: false,
        activePlayerCount: 0,
      });
    } catch (_error) {
      // bỏ qua lỗi dọn dẹp playback
    }

    if (props.returnToMatch) {
      setReplayReturnRequestSync({
        matchSessionId: props.matchSessionId,
        webcamFolderName: props.webcamFolderName,
        requestedAt: Date.now(),
      });

      if (Platform.OS === 'windows') {
        try {
          await deleteReplayFolder(props.webcamFolderName, {includeArchive: false});
        } catch (cleanupError) {
          console.log('[Replay] cleanup temp fail', cleanupError);
        }
      }
    }

    goBack();
  };

  const WEBCAM_LOADER = useMemo(() => {
    return (
      <View
        flex={'1'}
        style={styles.fullWidth}
        alignItems={'center'}
        justify={'center'}>
        <Loading isLoading size={'large'} showPlainLoading />
      </View>
    );
  }, []);

  const onPress = (index: number, path: string) => {
    const previousPath = currentVideoPath;
    const previousPlayerExists = Boolean(previousPath);

    try {
      viewModel.videoRef.current?.pause?.();
      viewModel.videoRef.current?.stop?.();
    } catch (error) {
      console.log('[VideoPlaybackControl]', {
        action: 'switch',
        targetVideoPath: previousPath,
        nativePauseCalled: false,
        nativeStopCalled: false,
        activePlayerCountAfterAction: previousPlayerExists ? 1 : 0,
        error,
      });
    }

    console.log('[SingleActivePlayer]', {
      requestedOpenVideo: path,
      previousPlayerExists,
      previousPlayerPaused: previousPlayerExists,
      previousPlayerStopped: previousPlayerExists,
      previousPlayerUnmounted: previousPlayerExists,
      nextPlayerMounted: true,
      activePlayerCount: 1,
    });
    console.log('[VideoPlaybackControl]', {
      action: 'switch',
      targetVideoPath: path,
      playerId: `playback-${index}-${path}`,
      pausedState: false,
      nativePauseCalled: previousPlayerExists,
      nativeStopCalled: previousPlayerExists,
      audioMuted: false,
      activePlayerCountAfterAction: 1,
    });

    setPlaybackCurrentTime(0);
    viewModel.setCurrentIndex(index);
  };

  const currentVideoPath =
    viewModel.videoFiles?.[viewModel.currentIndex]?.path || '';

  const currentVideoUri = useMemo(
    () => normalizePlaybackVideoUri(currentVideoPath),
    [currentVideoPath],
  );

  const playerKey = useMemo(
    () => `playback-${props.returnToMatch ? 'replay' : 'history'}-${viewModel.currentIndex}-${currentVideoPath}`,
    [currentVideoPath, props.returnToMatch, viewModel.currentIndex],
  );

  const currentVideoDuration =
    viewModel.videoDurations[currentVideoPath] || 0;

  const currentClipDisplay = useMemo(
    () => formatLocalReplayClipTime(viewModel.videoFiles?.[viewModel.currentIndex]),
    [viewModel.currentIndex, viewModel.videoFiles],
  );

  useEffect(() => {
    if (!viewModel.videoFiles.length) {
      return;
    }

    console.log('[ReplayClipSelector]', {
      clipsCount: viewModel.videoFiles.length,
      selectedClipIndex: viewModel.currentIndex,
      selectedClipPath: currentVideoPath,
      selectedClipDisplayTime: currentClipDisplay.formattedLocalTime,
    });
    console.log('[ReplayTimeFormat]', {
      rawTimestamp: currentClipDisplay.rawTimestamp,
      parsedDate: currentClipDisplay.parsedDate.toString(),
      timezoneOffsetMinutes: currentClipDisplay.parsedDate.getTimezoneOffset(),
      formattedLocalTime: currentClipDisplay.formattedLocalTime,
      formattedOldWrongTime: currentClipDisplay.formattedOldWrongTime,
      source: (viewModel.videoFiles?.[viewModel.currentIndex] as any)?.createdAtMs
        ? 'createdAtMs'
        : 'mtime',
    });
  }, [
    currentClipDisplay,
    currentVideoPath,
    viewModel.currentIndex,
    viewModel.videoFiles,
  ]);

  useEffect(() => {
    if (Platform.OS !== 'windows' || !currentVideoPath) {
      return;
    }

    const logPlayerState = async () => {
      let existsBeforePlay = false;
      let sizeBeforePlay = 0;

      try {
        existsBeforePlay = await RNFS.exists(currentVideoPath);
        if (existsBeforePlay) {
          const stat = await RNFS.stat(currentVideoPath);
          sizeBeforePlay = Number(stat?.size || 0);
        }
      } catch (error) {
        console.log('[ReplayPlayer]', {
          event: 'stat-failed',
          requestedPath: currentVideoPath,
          normalizedUri: currentVideoUri,
          playerSource: props.returnToMatch ? 'Replay' : 'History',
          playerKey,
          error,
        });
      }

      console.log('[ReplayPlayer]', {
        requestedPath: currentVideoPath,
        normalizedUri: currentVideoUri,
        existsBeforePlay,
        sizeBeforePlay,
        playerSource: props.returnToMatch ? 'Replay' : 'History',
        playerKey,
      });

      if (!existsBeforePlay || sizeBeforePlay <= 0) {
        console.log('[ReplayPlayer]', {
          event: 'player-not-ready',
          reason: !existsBeforePlay ? 'file chưa tồn tại' : 'file size = 0',
          requestedPath: currentVideoPath,
          normalizedUri: currentVideoUri,
          playerSource: props.returnToMatch ? 'Replay' : 'History',
        playerKey,
      });
      }
    };

    logPlayerState();
  }, [currentVideoPath, currentVideoUri, props.returnToMatch, playerKey]);

  useEffect(() => {
    if (!currentVideoPath) {
      return;
    }

    console.log('[VideoFreezeGuard]', {
      action: 'openPlayer',
      reason: 'watch player load/error timeout',
      asyncOperationStarted: true,
      playerKey,
    });

    const timer = setTimeout(() => {
      console.log('[VideoFreezeGuard]', {
        action: 'playerWatchdog',
        reason: 'no onLoad/onError within timeout; pause player to keep UI responsive',
        preventedFreeze: true,
        playerKey,
        requestedPath: currentVideoPath,
      });
      console.log('[VideoPlayerFreezeGuard]', {
        action: 'timeoutLogOnly',
        reason: 'player still mounted; do not pause automatically because native playback may be active',
        playerKey,
      });
    }, 10000);

    return () => clearTimeout(timer);
  }, [currentVideoPath, playerKey]);

  const getFileName = (filePath: string) => {
    return filePath.split('/').pop();
  };


  useEffect(() => {
    const videoTrimModule = NativeModules.VideoTrim;
    const supportsNativeEventEmitter = !!(
      videoTrimModule &&
      typeof videoTrimModule.addListener === 'function' &&
      typeof videoTrimModule.removeListeners === 'function'
    );

    const eventSource = supportsNativeEventEmitter
      ? new NativeEventEmitter(videoTrimModule)
      : DeviceEventEmitter;

    const subscription = eventSource.addListener('VideoTrim', async event => {
      switch (event.name) {
        case 'onLoad':
        case 'onShow':
        case 'onHide':
        case 'onStartTrimming':
        case 'onCancelTrimming':
        case 'onCancel':
        case 'onError':
        case 'onLog':
        case 'onStatistics':
          console.log(event.name, event);
          break;
        case 'onFinishTrimming': {
          const files = await listFiles();
          const archiveFolder = await ensureArchiveFolder(props.webcamFolderName);

          for (let index = 0; index < files.length; index += 1) {
            try {
              const fileName = getFileName(files[index]);
              const exportPath = `${archiveFolder}/${Date.now()}_${fileName}`;
              await RNFS.moveFile(files[index], exportPath);
              await deleteFile(files[index]);
            } catch (error) {
              console.error('Error saving video:', error);
            }
          }

          viewModel.loadFiles();
          break;
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [folder, viewModel.loadFiles]);



  const timelineBySegment = useMemo(() => {
    const grouped = new Map<number, ReplayScoreboardTimelineEntry[]>();

    for (const entry of scoreboardTimeline) {
      const list = grouped.get(entry.segmentIndex) || [];
      list.push(entry);
      grouped.set(entry.segmentIndex, list);
    }

    return grouped;
  }, [scoreboardTimeline]);

  const findTimelineEntryForPlayback = useCallback(() => {
    const currentSegmentEntries =
      timelineBySegment.get(viewModel.currentSegmentNumber) || [];

    if (!currentSegmentEntries.length) {
      return null;
    }

    const safeCurrentTime = Math.max(0, Number(playbackCurrentTime || 0));
    let left = 0;
    let right = currentSegmentEntries.length - 1;
    let matchedIndex = 0;

    while (left <= right) {
      const middle = Math.floor((left + right) / 2);
      const middleTime = Number(currentSegmentEntries[middle]?.segmentTime || 0);

      if (middleTime <= safeCurrentTime + 0.15) {
        matchedIndex = middle;
        left = middle + 1;
      } else {
        right = middle - 1;
      }
    }

    return currentSegmentEntries[matchedIndex] || null;
  }, [playbackCurrentTime, timelineBySegment, viewModel.currentSegmentNumber]);

  const renderOverlaySlot = useCallback(
    (imageList: string[], positionStyle: any) => {
      if (!thumbnailOverlay.enabled || imageList.length === 0) {
        return null;
      }

      return (
        <View pointerEvents={'none'} style={[overlayStyles.slot, positionStyle]}>
          {imageList.map((uri, index) => (
            <RNImage
              key={`${uri}-${index}`}
              source={{uri}}
              style={overlayStyles.image}
              resizeMode={'contain'}
            />
          ))}
        </View>
      );
    },
    [thumbnailOverlay.enabled],
  );

  const hasThumbnailImages =
    thumbnailOverlay.topLeft.length > 0 ||
    thumbnailOverlay.topRight.length > 0 ||
    thumbnailOverlay.bottomLeft.length > 0 ||
    thumbnailOverlay.bottomRight.length > 0;

  const renderFallbackPlaybackLogo = useCallback(() => {
    const fallbackSource = images.logoFilled || images.logo;

    if (!thumbnailOverlay.enabled || hasThumbnailImages || !fallbackSource) {
      return null;
    }

    return (
      <View pointerEvents={'none'} style={overlayStyles.overlayRoot}>
        <View pointerEvents={'none'} style={[overlayStyles.slot, overlayStyles.topLeft]}>
          <RNImage
            source={fallbackSource}
            style={overlayStyles.image}
            resizeMode={'contain'}
          />
        </View>
      </View>
    );
  }, [hasThumbnailImages, thumbnailOverlay.enabled]);

  const renderPlaybackLogoOverlay = useCallback(() => {
    if (!thumbnailOverlay.enabled) {
      return null;
    }

    if (!hasThumbnailImages) {
      return renderFallbackPlaybackLogo();
    }

    return (
      <View pointerEvents={'none'} style={overlayStyles.overlayRoot}>
        {renderOverlaySlot(thumbnailOverlay.topLeft, overlayStyles.topLeft)}
        {renderOverlaySlot(thumbnailOverlay.topRight, overlayStyles.topRight)}
        {renderOverlaySlot(thumbnailOverlay.bottomLeft, overlayStyles.bottomLeft)}
        {renderOverlaySlot(
          thumbnailOverlay.bottomRight,
          overlayStyles.bottomRight,
        )}
      </View>
    );
  }, [
    hasThumbnailImages,
    renderFallbackPlaybackLogo,
    renderOverlaySlot,
    thumbnailOverlay,
  ]);

  const activeTimelineEntry = useMemo(() => {
    return findTimelineEntryForPlayback();
  }, [findTimelineEntryForPlayback]);

  const lastOverlaySyncLogRef = useRef('');

  useEffect(() => {
    const logKey = JSON.stringify({
      source: props.returnToMatch ? 'Replay' : 'History',
      path: currentVideoPath,
      segment: viewModel.currentSegmentNumber,
      time: Math.floor(Number(playbackCurrentTime || 0) * 2) / 2,
      eventTime: activeTimelineEntry?.segmentTime,
      scoreAt: activeTimelineEntry?.savedAt,
    });

    if (lastOverlaySyncLogRef.current === logKey) {
      return;
    }

    lastOverlaySyncLogRef.current = logKey;

    const tag = props.returnToMatch ? '[ReplayOverlaySync]' : '[HistoryOverlaySync]';
    console.log(tag, {
      replayVideoPath: props.returnToMatch ? currentVideoPath : undefined,
      historyVideoPath: props.returnToMatch ? undefined : currentVideoPath,
      historyDurationMs: props.returnToMatch ? undefined : Math.round((currentVideoDuration || 0) * 1000),
      replayStartMatchElapsedMs: undefined,
      replayDurationMs: props.returnToMatch ? Math.round((currentVideoDuration || 0) * 1000) : undefined,
      playerCurrentTimeMs: Math.round(Number(playbackCurrentTime || 0) * 1000),
      overlayLookupTimeMs: Math.round(Number(playbackCurrentTime || 0) * 1000),
      selectedOverlayEventTimeMs: activeTimelineEntry
        ? Math.round(Number(activeTimelineEntry.segmentTime || 0) * 1000)
        : undefined,
      selectedScoreSnapshot: activeTimelineEntry
        ? {
            currentPlayerIndex: activeTimelineEntry.currentPlayerIndex,
            countdownTime: activeTimelineEntry.countdownTime,
            totalTurns: activeTimelineEntry.totalTurns,
          }
        : undefined,
      overlayTimelineEventsCount: scoreboardTimeline.length,
      usingLiveState: false,
    });

    const selectedScore = activeTimelineEntry?.playerSettings?.playingPlayers?.map(
      (player: any) => Number(player?.totalPoint || player?.point || 0),
    );

    console.log('[PlaybackOverlaySync]', {
      sourceType: props.returnToMatch ? 'replay' : 'history',
      videoPath: currentVideoPath,
      playerCurrentTimeMs: Math.round(Number(playbackCurrentTime || 0) * 1000),
      playbackPaused: false,
      playbackSeeking: false,
      overlayLookupTimeMs: Math.round(Number(playbackCurrentTime || 0) * 1000),
      selectedSnapshotTimeMs: activeTimelineEntry
        ? Math.round(Number(activeTimelineEntry.segmentTime || 0) * 1000)
        : undefined,
      selectedScore,
      usingLiveState: false,
    });
  }, [
    activeTimelineEntry,
    currentVideoDuration,
    currentVideoPath,
    playbackCurrentTime,
    props.returnToMatch,
    scoreboardTimeline.length,
    viewModel.currentSegmentNumber,
  ]);

  const playbackScoreboardProps = useMemo(() => {
    const timelineEntry = activeTimelineEntry;
    const resolvedCategory = timelineEntry?.category ?? gameSettings?.category;

    if (timelineEntry?.playerSettings) {
      return {
        category: resolvedCategory,
        gameSettings: {
          category: resolvedCategory,
          mode: {
            mode: timelineEntry.gameMode ?? gameSettings?.mode?.mode,
            countdownTime:
              timelineEntry.baseCountdown ?? gameSettings?.mode?.countdownTime ?? 0,
          },
          players: {
            goal: {
              goal:
                timelineEntry.goal ??
                gameSettings?.players?.goal?.goal ??
                replaySnapshot?.playerSettings?.goal?.goal ??
                0,
            },
          },
        },
        playerSettings: timelineEntry.playerSettings,
        currentPlayerIndex: timelineEntry.currentPlayerIndex ?? 0,
        countdownTime:
          timelineEntry.countdownTime ??
          timelineEntry.baseCountdown ??
          gameSettings?.mode?.countdownTime ??
          0,
        totalTurns: timelineEntry.totalTurns ?? replaySnapshot?.totalTurns ?? 1,
      };
    }

    console.log(props.returnToMatch ? '[ReplayOverlaySync]' : '[HistoryOverlaySync]', {
      event: 'noTimelineSnapshotForPlayback',
      replayVideoPath: props.returnToMatch ? currentVideoPath : undefined,
      historyVideoPath: props.returnToMatch ? undefined : currentVideoPath,
      playerCurrentTimeMs: Math.round(Number(playbackCurrentTime || 0) * 1000),
      overlayTimelineEventsCount: scoreboardTimeline.length,
      usingLiveState: false,
      reason: 'No timeline entry matched current video time; do not render live/current match state over old video.',
    });

    return null;
  }, [
    activeTimelineEntry,
    currentVideoPath,
    gameSettings,
    playbackCurrentTime,
    props.returnToMatch,
    scoreboardTimeline.length,
  ]);

  const lastTimerSyncLogRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastTimerSyncLogRef.current < 1000) {
      return;
    }

    lastTimerSyncLogRef.current = now;
    console.log('[PlaybackTimerSync]', {
      sourceType: props.returnToMatch ? 'replay' : 'history',
      onProgressCurrentTimeMs: Math.round(Number(playbackCurrentTime || 0) * 1000),
      interpolatedCurrentTimeMs: Math.round(Number(playbackCurrentTime || 0) * 1000),
      paused: false,
      playbackRate,
      countdownValue: playbackScoreboardProps?.countdownTime,
      usedLiveTimer: false,
    });
  }, [
    playbackCurrentTime,
    playbackRate,
    props.returnToMatch,
    playbackScoreboardProps?.countdownTime,
  ]);

  const shouldShowPlaybackMatchOverlay = useMemo(() => {
    if (!playbackScoreboardProps) {
      return false;
    }

    return shouldShowMatchOverlay(
      playbackScoreboardProps.gameSettings,
      playbackScoreboardProps.playerSettings,
    );
  }, [playbackScoreboardProps]);

  const renderPlaybackScoreboard = useCallback(() => {
    if (!playbackScoreboardProps || !shouldShowPlaybackMatchOverlay) {
      return null;
    }

    const category = playbackScoreboardProps.category;

    if (
  isPool9Game(category) ||
  isPool10Game(category) ||
  isPool15Game(category)
) {
      return (
        <PoolBroadcastScoreboard
          gameSettings={playbackScoreboardProps.gameSettings}
          playerSettings={playbackScoreboardProps.playerSettings}
          currentPlayerIndex={playbackScoreboardProps.currentPlayerIndex}
          countdownTime={playbackScoreboardProps.countdownTime}
          variant={'playback'}
          bottomOffset={PLAYBACK_NATIVE_CONTROLS_BOTTOM_INSET}
        />
      );
    }

    if (isCaromGame(category)) {
      return (
        <CaromBroadcastScoreboard
          gameSettings={playbackScoreboardProps.gameSettings}
          playerSettings={playbackScoreboardProps.playerSettings}
          currentPlayerIndex={playbackScoreboardProps.currentPlayerIndex}
          countdownTime={playbackScoreboardProps.countdownTime}
          totalTurns={playbackScoreboardProps.totalTurns}
          variant={'playback'}
          bottomOffset={PLAYBACK_NATIVE_CONTROLS_BOTTOM_INSET}
        />
      );
    }

    return null;
  }, [playbackScoreboardProps, shouldShowPlaybackMatchOverlay]);

  useEffect(() => {
    if (!currentVideoPath) {
      return;
    }

    console.log('[VideoLayering]', {
      playerContainerZ: 0,
      overlayZ: 12,
      nativeControlsVisible: Platform.OS === 'windows',
      overlayBottomInset: PLAYBACK_NATIVE_CONTROLS_BOTTOM_INSET,
      overlayCoversControls: false,
    });
  }, [currentVideoPath]);

  return (
    <Container>
      <View direction={'row'}>
        <View margin={'20'}>
          <View direction={'row'} marginBottom={'20'}>
            <View flex={'1'} justify={'center'} alignItems={'center'}>
              <Text fontSize={16} fontWeight={'bold'}>
                {i18n.t('reWatch')}
              </Text>
            </View>
          </View>
          <View flex={'1'} style={{alignItems: 'center'}}>
            {viewModel.videoFiles.length > 0 ? (
              <>
                <Text style={styles.selectorTitle}>{i18n.t('txtChooseReplaySegment')}</Text>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  style={styles.selectorScroll}>
                  {viewModel.videoFiles.map((item, index) => {
                    const clipTime = formatLocalReplayClipTime(item).formattedLocalTime;
                    return (
                      <VideoListItem
                        key={`${item.path}-${index}`}
                        time={`${index + 1}. ${clipTime}`}
                        path={item.path}
                        onPress={() => onPress(index, item.path)}
                        index={index}
                        currentIndex={viewModel.currentIndex}
                      />
                    );
                  })}
                </ScrollView>
                <Button style={styles.rateButton} onPress={cyclePlaybackRate}>
                  <Text style={styles.rateButtonText}>{i18n.t('txtPlaybackSpeed', {rate: playbackRate})}</Text>
                </Button>
              </>
            ) : (
              <Text lineHeight={15}>{i18n.t('txtNoVideo')}</Text>
            )}
          </View>

          <Button style={styles.buttonBack} onPress={onBackToMatch}>
            <View direction={'row'} alignItems={'center'}>
              <Image source={images.back} style={styles.iconBack} />
              <Text lineHeight={15}>{i18n.t('txtBack')}</Text>
            </View>
          </Button>
        </View>

        <View flex={'1'} style={styles.webcamContainer}>
          {viewModel.isLoading ? (
            <View style={styles.webcam}>{WEBCAM_LOADER}</View>
          ) : viewModel.videoFiles.length > 0 ? (
            <View style={styles.webcam} collapsable={false}>
              <Video
                key={playerKey}
                resizeMode="contain"
                id={'webcam-billiards-playback'}
                ref={viewModel.videoRef}
                style={styles.webcam}
                controls={Platform.OS === 'windows' ? true : false}
                paused={false}
                source={{
                  uri: currentVideoUri,
                }}
                selectedVideoTrack={WEBCAM_SELECTED_VIDEO_TRACK}
                onError={error => {
                  console.log('[ReplayPlayer]', {
                    event: 'onError',
                    requestedPath: currentVideoPath,
                    normalizedSource: currentVideoUri,
                    playerKey,
                    playerSource: props.returnToMatch ? 'Replay' : 'History',
                    error,
                  });
                  viewModel.onWebcamError(error);
                }}
                renderLoader={WEBCAM_LOADER}
                rate={playbackRate}
                progressUpdateInterval={100}
                onLoadStart={() => {
                  console.log('[ReplayPlayer]', {
                    event: 'open',
                    requestedPath: currentVideoPath,
                    normalizedSource: currentVideoUri,
                    playerKey,
                    playerSource: props.returnToMatch ? 'Replay' : 'History',
                  });
                }}
                startAtTailSeconds={props.returnToMatch ? 60 : 0}
                onLoad={data => {
                  console.log('[VideoFreezeGuard]', {
                    action: 'playerLoad',
                    asyncOperationFinished: true,
                    playerKey,
                  });
                  const duration = Number(data?.duration || 0);
                  console.log('[ReplayPlayer]', {
                    event: 'onLoad',
                    requestedPath: currentVideoPath,
                    normalizedSource: currentVideoUri,
                    playerKey,
                    duration,
                    playerSource: props.returnToMatch ? 'Replay' : 'History',
                  });
                  viewModel.handleVideoLoad(currentVideoPath, duration);
                  setPlaybackCurrentTime(0);
                  viewModel.handleLoad();

                  if (props.returnToMatch && duration > 60.05) {
                    const replayStartTime = Math.max(0, duration - 60);
                    try {
                      viewModel.videoRef.current?.seek?.(replayStartTime);
                      setPlaybackCurrentTime(replayStartTime);
                      console.log('[Replay]', {event: 'seekToTail', replayStartTime, duration});
                    } catch (seekError) {
                      console.log('[Replay] seek to recent VAR window failed', seekError);
                    }
                  }
                }}
                onReadyForDisplay={() => {
                  console.log('[VideoPlayerEvents]', {
                    event: 'onReadyForDisplay',
                    requestedPath: currentVideoPath,
                    normalizedSource: currentVideoUri,
                    playerKey,
                    playerSource: props.returnToMatch ? 'Replay' : 'History',
                  });
                }}
                onBuffer={data => {
                  console.log('[ReplayPlayer]', {
                    event: 'onBuffer',
                    playerKey,
                    isBuffering: data?.isBuffering,
                    playerSource: props.returnToMatch ? 'Replay' : 'History',
                  });
                }}
                onProgress={data => {
                  const currentTime = Number(data?.currentTime || 0);
                  setPlaybackCurrentTime(currentTime);
                  viewModel.handleProgress({...data, currentTime});
                }}
                onEnd={() => {
                  console.log('[ReplayPlayer]', {
                    event: 'onEnd',
                    requestedPath: currentVideoPath,
                    normalizedSource: currentVideoUri,
                    playerKey,
                    playerSource: props.returnToMatch ? 'Replay' : 'History',
                  });
                  viewModel.handleNext();
                }}
              />
              {Platform.OS === 'windows' ? null : (
                <View
                  style={overlayStyles.touchBlocker}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                />
              )}
              {shouldShowPlaybackMatchOverlay ? renderPlaybackLogoOverlay() : null}
              {renderPlaybackScoreboard()}


              </View>
          ) : (
            <View style={styles.webcam} />
          )}
        </View>

        {viewModel.videoFiles.length > 0 ? (
          <Button
            style={styles.buttonShare}
            onPress={() => {
              showEditor(viewModel.videoFiles[viewModel.currentIndex].path, {
                type: 'video',
                outputExt: 'mov',
                trimmingText: i18n.t('trimmingText'),
                cancelTrimmingDialogMessage: i18n.t(
                  'cancelTrimmingDialogMessage',
                ),
                cancelTrimmingButtonText: i18n.t('cancelTrimmingButtonText'),
                saveDialogConfirmText: i18n.t('saveDialogConfirmText'),
                saveDialogTitle: i18n.t('saveDialogTitle'),
                saveButtonText: i18n.t('saveButtonText'),
                saveDialogMessage: i18n.t('saveDialogMessage'),
                cancelDialogConfirmText: i18n.t('cancelDialogConfirmText'),
                openDocumentsOnFinish: false,
                cancelButtonText: i18n.t('cancelButtonText'),
                cancelTrimmingDialogCancelText: i18n.t(
                  'cancelTrimmingDialogCancelText',
                ),
                cancelDialogCancelText: i18n.t('cancelDialogCancelText'),
                cancelDialogMessage: i18n.t('cancelDialogMessage'),
              });
            }}>
            <Image source={images.videoEditor} style={styles.iconShare} />
          </Button>
        ) : (
          <View />
        )}
      </View>
    </Container>
  );
};

const overlayStyles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 12,
    elevation: 12,
  },
  slot: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'flex-start',
    maxWidth: '42%',
  },
  topLeft: {
    top: 10,
    left: 10,
  },
  topRight: {
    top: 10,
    right: 10,
  },
  bottomLeft: {
    bottom: PLAYBACK_NATIVE_CONTROLS_BOTTOM_INSET,
    left: 10,
  },
  bottomRight: {
    bottom: PLAYBACK_NATIVE_CONTROLS_BOTTOM_INSET,
    right: 10,
  },
  touchBlocker: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9,
  },
  image: {
    width: 120,
    height: 70,
    marginRight: 8,
  },
});

export default memo(PlayBackWebcam);
