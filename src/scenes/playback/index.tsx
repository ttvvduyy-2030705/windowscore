import React, {memo, useCallback, useEffect, useMemo, useState} from 'react';
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
import Slider from '@react-native-community/slider';
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
  const viewModel = PlayBackWebcamViewModel(props);
  const {adaptive, design} = useDesignSystem();
  const styles = useMemo(() => createStyles(adaptive, design), [adaptive.styleKey, design]);
  const {gameSettings} = useSelector((state: RootState) => state.game);

  const [folder, setFolder] = useState<string>(
    buildReplayFolderPath(props.webcamFolderName),
  );
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [thumbnailOverlay, setThumbnailOverlay] =
    useState<PlaybackThumbnailOverlayState>(EMPTY_THUMBNAIL_OVERLAY);
  const [replaySnapshot, setReplaySnapshot] =
    useState<ReplayOverlaySnapshot | null>(null);
  const [scoreboardTimeline, setScoreboardTimeline] =
    useState<ReplayScoreboardTimelineEntry[]>([]);
  const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);

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
      setScoreboardTimeline(timeline?.entries || []);
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
      } catch (_error) {
        // ignore cleanup errors
      }
    };
  }, [viewModel.videoRef]);

  const onBackToMatch = async () => {
    try {
      viewModel.videoRef.current?.pause?.();
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

  const onPress = (index: number, _path: string) => {
    setPlaybackCurrentTime(0);
    setIsPaused(false);
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

  const safeSeekTo = useCallback((time: number) => {
    const boundedDuration = Math.max(0, Number(currentVideoDuration || 0));
    const nextTime = Math.max(0, Math.min(Number(time || 0), boundedDuration > 0 ? boundedDuration - 0.05 : Number(time || 0)));
    try {
      viewModel.videoRef.current?.seek?.(nextTime);
      setPlaybackCurrentTime(nextTime);
    } catch (_error) {
      // ignore seek errors to keep replay stable
    }
  }, [currentVideoDuration, viewModel.videoRef]);

  const seekBy = useCallback((deltaSeconds: number) => {
    safeSeekTo(Math.max(0, Number(playbackCurrentTime || 0) + deltaSeconds));
  }, [playbackCurrentTime, safeSeekTo]);

  const togglePaused = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

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


  useEffect(() => {
    setIsPaused(false);
    setIsScrubbing(false);
  }, [viewModel.currentIndex, currentVideoPath]);

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

  const playbackScoreboardProps = useMemo(() => {
    const timelineEntry = findTimelineEntryForPlayback();
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

    const hasMatchingSnapshot =
      replaySnapshot?.webcamFolderName === props.webcamFolderName;

    if (!hasMatchingSnapshot || !replaySnapshot?.playerSettings) {
      return null;
    }

    return {
      category: gameSettings?.category,
      gameSettings,
      playerSettings: replaySnapshot.playerSettings,
      currentPlayerIndex: replaySnapshot.currentPlayerIndex ?? 0,
      countdownTime:
        replaySnapshot.countdownTime ?? gameSettings?.mode?.countdownTime ?? 0,
      totalTurns: replaySnapshot.totalTurns ?? 1,
    };
  }, [
    findTimelineEntryForPlayback,
    gameSettings,
    props.webcamFolderName,
    replaySnapshot,
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
          bottomOffset={62}
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
          bottomOffset={62}
        />
      );
    }

    return null;
  }, [playbackScoreboardProps, shouldShowPlaybackMatchOverlay]);

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
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={{height: 300}}>
                {viewModel.videoFiles.map((item, index) => (
                  <VideoListItem
                    key={index}
                    time={item.mtime?.toLocaleTimeString()}
                    path={item.path}
                    onPress={() => onPress(index, item.path)}
                    index={index}
                    currentIndex={viewModel.currentIndex}
                  />
                ))}
              </ScrollView>
            ) : (
              <Text lineHeight={15}>No video!</Text>
            )}


            <Text style={styles.label}>
              {i18n.t('txtTocDoXem')}: {playbackRate.toFixed(2)}x
            </Text>

            <Slider
              style={styles.slider}
              minimumValue={0.25}
              maximumValue={2.0}
              step={0.25}
              value={playbackRate}
              onValueChange={(value: React.SetStateAction<number>) =>
                setPlaybackRate(value)
              }
            />
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
                paused={isPaused || isScrubbing}
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
                progressUpdateInterval={500}
                onLoadStart={() => {
                  console.log('[ReplayPlayer]', {
                    event: 'open',
                    requestedPath: currentVideoPath,
                    normalizedSource: currentVideoUri,
                    playerKey,
                    playerSource: props.returnToMatch ? 'Replay' : 'History',
                  });
                }}
                startAtTailSeconds={props.returnToMatch ? 30 : 0}
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

                  if (props.returnToMatch && duration > 30.05) {
                    const replayStartTime = Math.max(0, duration - 30);
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
                  if (!isScrubbing) {
                    setPlaybackCurrentTime(data?.currentTime || 0);
                  }
                  viewModel.handleProgress(data);
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
              <View style={overlayStyles.transportBar} pointerEvents={'box-none'}>
                <View style={overlayStyles.transportButtons}>
                  <Button style={overlayStyles.transportButton} onPress={viewModel.handlePrevious}>
                    <Text lineHeight={15}>{'Prev'}</Text>
                  </Button>
                  <Button style={overlayStyles.transportButton} onPress={() => seekBy(-10)}>
                    <Text lineHeight={15}>{'-10s'}</Text>
                  </Button>
                  <Button style={overlayStyles.transportButtonPrimary} onPress={togglePaused}>
                    <Text lineHeight={15}>{isPaused ? 'Play' : 'Pause'}</Text>
                  </Button>
                  <Button style={overlayStyles.transportButton} onPress={() => seekBy(10)}>
                    <Text lineHeight={15}>{'+10s'}</Text>
                  </Button>
                  <Button style={overlayStyles.transportButton} onPress={viewModel.handleNext}>
                    <Text lineHeight={15}>{'Next'}</Text>
                  </Button>
                </View>
                <View style={overlayStyles.scrubberRow}>
                  <Text style={overlayStyles.timeLabel}>
                    {Math.floor(playbackCurrentTime / 60)}:{String(Math.floor(playbackCurrentTime % 60)).padStart(2, '0')}
                  </Text>
                  <Slider
                    style={overlayStyles.scrubber}
                    minimumValue={0}
                    maximumValue={Math.max(currentVideoDuration, 1)}
                    value={Math.min(playbackCurrentTime, Math.max(currentVideoDuration, 1))}
                    minimumTrackTintColor={'#ffffff'}
                    maximumTrackTintColor={'rgba(255,255,255,0.35)'}
                    thumbTintColor={'#ffffff'}
                    onSlidingStart={() => setIsScrubbing(true)}
                    onValueChange={value => setPlaybackCurrentTime(Number(value || 0))}
                    onSlidingComplete={value => {
                      safeSeekTo(Number(value || 0));
                      setIsScrubbing(false);
                    }}
                  />
                  <Text style={overlayStyles.timeLabel}>
                    {Math.floor(currentVideoDuration / 60)}:{String(Math.floor(currentVideoDuration % 60)).padStart(2, '0')}
                  </Text>
                </View>
              </View>
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
    bottom: 10,
    left: 10,
  },
  bottomRight: {
    bottom: 10,
    right: 10,
  },
  touchBlocker: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9,
  },
  transportBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 8,
    zIndex: 20,
    elevation: 20,
  },
  transportButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  transportButton: {
    minWidth: 70,
    marginHorizontal: 4,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 8,
  },
  transportButtonPrimary: {
    minWidth: 82,
    marginHorizontal: 4,
    paddingVertical: 8,
    backgroundColor: 'rgba(170,0,0,0.78)',
    borderRadius: 8,
  },
  scrubberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scrubber: {
    flex: 1,
    height: 28,
    marginHorizontal: 8,
  },
  timeLabel: {
    color: '#ffffff',
    fontSize: 12,
    minWidth: 38,
    textAlign: 'center',
  },
  image: {
    width: 120,
    height: 70,
    marginRight: 8,
  },
});

export default memo(PlayBackWebcam);
