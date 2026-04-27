import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Alert} from 'react-native';
import {OnVideoErrorData, VideoRef} from 'react-native-video';
import RNFS from 'react-native-fs';

import i18n from 'i18n';
import {extractReplaySegmentIndex, listPlayableFiles, listReplayFiles, resolveReplayFolder, waitForReplayFiles} from 'services/replay/localReplay';

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

  const handleVideoLoad = useCallback((videoUri: string, duration: number) => {
    setVideoDurations(prev => ({...prev, [videoUri]: duration}));
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

      const files = props.returnToMatch
        ? (await waitForReplayFiles(props.webcamFolderName, 1, 8000)).length > 0
          ? await waitForReplayFiles(props.webcamFolderName, 1, 8000)
          : await listReplayFiles(props.webcamFolderName)
        : await listPlayableFiles(props.webcamFolderName, true);
      if (loadRequestIdRef.current !== requestId) {
        return;
      }

      setVideoFiles(files);
      setTotalFiles(files.length);

      const initialIndex =
        props.returnToMatch && files.length > 0
          ? files.length - 1
          : files.length === 0
            ? 0
            : 0;

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
        console.log('[Replay] selected replay segments', files.map(file => file.path));
        console.log('[Replay] replay duration', 'target=120s');
      }

      if (files.length === 0) {
        console.log('[Replay] No files found after extended retry:', props.webcamFolderName);
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
    (_e: OnVideoErrorData) => {
      const previousIndex = currentIndex - 1;
      const nextIndex = currentIndex + 1;

      if (previousIndex >= 0) {
        console.log('[Replay] fallback to previous clip:', previousIndex);
        setCurrentIndex(previousIndex);
        return;
      }

      if (nextIndex < videoFiles.length) {
        console.log('[Replay] fallback to next clip:', nextIndex);
        setCurrentIndex(nextIndex);
        return;
      }

      setIsPlaying(false);
      Alert.alert(i18n.t('txtError'), i18n.t('msgWebcamVideoNotExist'));
    },
    [currentIndex, videoFiles.length],
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
