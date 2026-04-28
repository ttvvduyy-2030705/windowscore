import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Platform} from 'react-native';
import {OnVideoErrorData, VideoRef} from 'react-native-video';
import RNFS from 'react-native-fs';

import i18n from 'i18n';
import {
  REPLAY_WINDOW_SECONDS,
  extractReplaySegmentIndex,
  listPlayableFiles,
  listReplayFiles,
  resolveReplayFolder,
  waitForReplayFiles,
  normalizeWindowsVideoUri,
} from 'services/replay/localReplay';

export interface PlayBackWebcamViewModelProps {
  webcamFolderName: string;
  merged: boolean;
  videoUri?: string;
  returnToMatch?: boolean;
  matchSessionId?: string;
}

const PlayBackWebcamViewModel = (props: PlayBackWebcamViewModelProps) => {
  const videoRef = useRef<VideoRef>(null);
  const [totalFiles, setTotalFiles] = useState(0);
  const [selectedDurationIndex, setSelectedDurationIndex] = useState<number>();
  const [isLoading, setIsLoading] = useState(false);
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({});
  const [videoFiles, setVideoFiles] = useState<RNFS.ReadDirItem[]>([]);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [resolvedFolder, setResolvedFolder] = useState<string>();
  const [currentSegmentNumber, setCurrentSegmentNumber] = useState<number>(0);
  const failedVideoPathsRef = useRef<Set<string>>(new Set());

  const handleVideoLoad = useCallback((videoUri: string, duration: number) => {
    failedVideoPathsRef.current.delete(videoUri);
    setVideoDurations(prev => ({...prev, [videoUri]: duration}));
    console.log('[ReplayPlayer]', {
      event: 'onLoad',
      requestedPath: videoUri,
      normalizedSource: Platform.OS === 'windows' ? normalizeWindowsVideoUri(videoUri) : videoUri,
      duration,
    });
  }, []);

  const handleNext = useCallback(() => {
    if (currentIndex < videoFiles.length - 1) {
      videoRef.current?.seek(0);
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, videoFiles.length]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      videoRef.current?.seek(0);
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex]);

  const handleLoad = useCallback(() => {
    videoRef.current?.seek(startTime);
    videoRef.current?.resume?.();
  }, [startTime]);

  const handleProgress = useCallback(
    (data: any) => {
      if (endTime > 0 && data.currentTime >= endTime && isPlaying) {
        videoRef.current?.pause?.();
        setIsPlaying(false);
      }
    },
    [endTime, isPlaying],
  );

  const loadRequestIdRef = useRef(0);

  const loadFiles = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setIsLoading(true);

    try {
      const folder = await resolveReplayFolder(props.webcamFolderName);
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setResolvedFolder(folder);

      if (!folder) {
        setVideoFiles([]);
        setTotalFiles(0);
        setCurrentIndex(0);
        setIsPlaying(false);
        console.log('[Replay] Folder does not exist:', props.webcamFolderName);
        return;
      }

      const waitedReplayFiles = props.returnToMatch
        ? await waitForReplayFiles(props.webcamFolderName, 1, 8000)
        : [];
      const files = props.returnToMatch
        ? waitedReplayFiles.length > 0
          ? waitedReplayFiles
          : await listReplayFiles(props.webcamFolderName)
        : await listPlayableFiles(props.webcamFolderName, true);
      if (loadRequestIdRef.current !== requestId) {
        return;
      }

      for (const file of files) {
        try {
          const existsBeforePlay = await RNFS.exists(file.path);
          const stat = existsBeforePlay ? await RNFS.stat(file.path) : undefined;
          const sizeBeforePlay = Number(stat?.size || file.size || 0);
          console.log('[ReplayPlayer]', {
            requestedPath: file.path,
            existsBeforePlay,
            sizeBeforePlay,
            playerSource: props.returnToMatch ? 'Replay' : 'History',
          });
        } catch (error) {
          console.log('[ReplayPlayer]', {
            event: 'stat-failed',
            requestedPath: file.path,
            playerSource: props.returnToMatch ? 'Replay' : 'History',
            error,
          });
        }
      }

      setVideoFiles(files);
      setTotalFiles(files.length);

      const initialIndex = files.length === 0 ? 0 : 0;

      setCurrentIndex(initialIndex);
      setCurrentSegmentNumber(
        files.length > 0
          ? extractReplaySegmentIndex(files[initialIndex]?.name) || initialIndex
          : 0,
      );
      setStartTime(0);
      setEndTime(0);
      setIsPlaying(files.length > 0);

      if (props.returnToMatch) {
        const estimatedReplayDuration = Math.min(
          REPLAY_WINDOW_SECONDS,
          Math.max(0, files.length) * 30,
        );
        console.log('[Replay] selected replay segments', files.map(file => file.path));
        console.log('[Replay] replay duration', `target=${REPLAY_WINDOW_SECONDS}s estimated=${estimatedReplayDuration}s`);
        console.log('[ReplayBuffer]', {
          targetWindowSeconds: REPLAY_WINDOW_SECONDS,
          finalizedSegmentsCount: files.length,
          selectedSegments: files.map(file => file.path),
          selectedTotalDuration: estimatedReplayDuration,
          reasonIfShorterThanTarget:
            estimatedReplayDuration < REPLAY_WINDOW_SECONDS
              ? `only ${files.length} finalized segment(s) available`
              : undefined,
        });
      }

      if (files.length === 0) {
        console.log('[Replay] No files found after extended retry:', props.webcamFolderName);
        console.log('[ReplayPlayer]', {
          event: 'player-not-ready',
          reason: props.returnToMatch ? 'video bị xóa trước khi mở hoặc recorder chưa finalize' : 'History folder không có video',
          requestedPath: folder,
          playerSource: props.returnToMatch ? 'Replay' : 'History',
        });
      }
    } catch (error) {
      console.log('[VideoFreezeGuard]', {
        action: 'loadFiles',
        reason: 'caught replay/history file loading error',
        preventedFreeze: true,
        errorCaught: error,
      });
      if (loadRequestIdRef.current === requestId) {
        setVideoFiles([]);
        setTotalFiles(0);
        setCurrentIndex(0);
        setIsPlaying(false);
      }
    } finally {
      if (loadRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [props.webcamFolderName, props.returnToMatch]);

  useEffect(() => {
    loadFiles();

    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [loadFiles]);

  const onSelectMinuteForWebcam = useCallback(
    async (index: number, duration: number) => {
      setIsLoading(true);
      setSelectedDurationIndex(index);

      const files = props.returnToMatch
        ? await listReplayFiles(props.webcamFolderName)
        : await listPlayableFiles(props.webcamFolderName, true);

      if (!files.length) {
        Alert.alert(i18n.t('txtError'), i18n.t('msgWebcamVideoNotExist'));
        setIsLoading(false);
        return;
      }

      setVideoFiles(files);
      setTotalFiles(files.length);
      setIsLoading(false);

      const targetSeconds = Math.max(0, duration * 60);
      let remaining = targetSeconds;
      let chosenIndex = Math.max(0, files.length - 1);
      let chosenOffset = 0;

      for (let fileIndex = files.length - 1; fileIndex >= 0; fileIndex -= 1) {
        const filePath = files[fileIndex]?.path || '';
        const estimatedDuration =
          videoDurations[filePath] ||
          (fileIndex === files.length - 1 ? Math.max(videoDurations[filePath] || 0, 1) : 120);

        if (remaining <= estimatedDuration) {
          chosenIndex = fileIndex;
          chosenOffset = Math.max(0, estimatedDuration - remaining);
          break;
        }

        remaining -= estimatedDuration;
        chosenIndex = fileIndex;
        chosenOffset = 0;
      }

      setCurrentIndex(chosenIndex);
      setCurrentSegmentNumber(extractReplaySegmentIndex(files[chosenIndex]?.name) || chosenIndex);
      setStartTime(chosenOffset);
      setEndTime(0);
      setIsPlaying(true);
    },
    [props.returnToMatch, props.webcamFolderName, videoDurations],
  );


  useEffect(() => {
    const currentFile = videoFiles[currentIndex];
    setCurrentSegmentNumber(
      currentFile ? extractReplaySegmentIndex(currentFile.name) || currentIndex : 0,
    );
  }, [currentIndex, videoFiles]);

  const onWebcamError = useCallback(
    (e: OnVideoErrorData) => {
      const currentPath = videoFiles[currentIndex]?.path || '';
      if (currentPath) {
        failedVideoPathsRef.current.add(currentPath);
      }

      console.log('[ReplayPlayer]', {
        event: 'onError',
        requestedPath: currentPath,
        normalizedSource: Platform.OS === 'windows' ? normalizeWindowsVideoUri(currentPath) : currentPath,
        playerKey: currentPath ? `video-${currentIndex}-${currentPath}` : undefined,
        error: e,
      });
      console.log('[VideoFreezeGuard]', {
        action: 'onVideoError',
        reason: 'skip failed source and prevent previous/next error loop',
        preventedFreeze: true,
      });

      const nextIndex = videoFiles.findIndex((file, index) => (
        index !== currentIndex && !failedVideoPathsRef.current.has(file.path)
      ));

      if (nextIndex >= 0) {
        console.log('[Replay] fallback to playable clip:', nextIndex);
        setCurrentIndex(nextIndex);
        return;
      }

      setIsPlaying(false);
      Alert.alert(i18n.t('txtError'), i18n.t('msgWebcamVideoNotExist'));
    },
    [currentIndex, videoFiles],
  );

  return useMemo(
    () => ({
      videoRef,
      isLoading,
      selectedDurationIndex,
      onSelectMinuteForWebcam,
      onWebcamError,
      handleVideoLoad,
      handleProgress,
      isPlaying,
      handleLoad,
      handleNext,
      handlePrevious,
      videoFiles,
      currentIndex,
      setCurrentIndex,
      videoDurations,
      totalFiles,
      loadFiles,
      resolvedFolder,
      currentSegmentNumber,
    }),
    [
      isLoading,
      selectedDurationIndex,
      onSelectMinuteForWebcam,
      onWebcamError,
      handleVideoLoad,
      handleProgress,
      isPlaying,
      handleLoad,
      handleNext,
      handlePrevious,
      videoFiles,
      currentIndex,
      videoDurations,
      totalFiles,
      loadFiles,
      resolvedFolder,
      currentSegmentNumber,
    ],
  );
};

export default PlayBackWebcamViewModel;
