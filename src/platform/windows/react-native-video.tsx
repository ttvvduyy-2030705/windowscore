import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  View,
} from 'react-native';

type SourceShape =
  | string
  | {
      uri?: string;
      type?: string;
      [key: string]: any;
    };

type WindowsVideoProps = {
  source?: SourceShape;
  style?: any;
  resizeMode?: 'contain' | 'cover' | 'stretch' | string;
  paused?: boolean;
  controls?: boolean;
  rate?: number;
  onLoad?: (data: {duration: number}) => void;
  onLoadStart?: () => void;
  onProgress?: (data: {currentTime: number}) => void;
  onBuffer?: (data: {isBuffering: boolean}) => void;
  onEnd?: () => void;
  onError?: (error: any) => void;
  onReadyForDisplay?: () => void;
  startAtTailSeconds?: number;
  renderLoader?: React.ReactNode;
  [key: string]: any;
};

const NativeWindowsVideoPlayer = requireNativeComponent<any>('WindowsVideoPlayerView');

const normalizeWindowsVideoUri = (input?: SourceShape) => {
  const raw =
    typeof input === 'string'
      ? input
      : input && typeof input === 'object' && typeof input.uri === 'string'
        ? input.uri
        : '';

  if (!raw) {
    return '';
  }

  if (/^[a-z]+:\/\//i.test(raw) && !raw.toLowerCase().startsWith('file://')) {
    return raw;
  }

  if (raw.toLowerCase().startsWith('file://')) {
    const normalized = raw.replace(/\\/g, '/');
    return normalized.replace(/^file:\/\/(?!\/)/i, 'file:///');
  }

  const slashPath = raw.replace(/\\/g, '/');
  const encodedPath = slashPath
    .split('/')
    .map((part, index) => {
      if (index === 0 && /^[a-zA-Z]:$/.test(part)) {
        return part;
      }

      return encodeURIComponent(part);
    })
    .join('/');

  return `file:///${encodedPath}`;
};

const getSyntheticDuration = (startAtTailSeconds: number, sourceUri: string) => {
  const tail = Math.max(0, Number(startAtTailSeconds || 0));
  if (tail > 0) {
    return Math.max(1, tail);
  }

  return sourceUri ? 1 : 0;
};

const VideoWindows = forwardRef<any, WindowsVideoProps>((props, ref) => {
  const {
    source,
    style,
    resizeMode = 'contain',
    paused = false,
    controls = false,
    rate = 1,
    onLoad,
    onLoadStart,
    onProgress,
    onBuffer,
    onEnd,
    onError,
    onReadyForDisplay,
    startAtTailSeconds = 0,
  } = props;

  const [currentTime, setCurrentTime] = useState(0);
  const [imperativePaused, setImperativePaused] = useState(false);
  const [imperativeStopped, setImperativeStopped] = useState(false);
  const currentTimeRef = useRef(0);
  const sourceUri = useMemo(() => normalizeWindowsVideoUri(source), [source]);
  const effectiveSourceUri = imperativeStopped ? '' : sourceUri;
  const effectivePaused = paused || imperativePaused || imperativeStopped;
  const lastLoadedSourceRef = useRef<string>('');

  const onLoadRef = useRef(onLoad);
  const onLoadStartRef = useRef(onLoadStart);
  const onProgressRef = useRef(onProgress);
  const onBufferRef = useRef(onBuffer);
  const onEndRef = useRef(onEnd);
  const onErrorRef = useRef(onError);
  const onReadyForDisplayRef = useRef(onReadyForDisplay);

  useEffect(() => {
    onLoadRef.current = onLoad;
    onLoadStartRef.current = onLoadStart;
    onProgressRef.current = onProgress;
    onBufferRef.current = onBuffer;
    onEndRef.current = onEnd;
    onErrorRef.current = onError;
    onReadyForDisplayRef.current = onReadyForDisplay;
  }, [onLoad, onLoadStart, onProgress, onBuffer, onEnd, onError, onReadyForDisplay]);

  useEffect(() => {
    setImperativeStopped(false);
    setImperativePaused(false);
    currentTimeRef.current = 0;
    setCurrentTime(0);
  }, [sourceUri]);

  const seek = useCallback((time: number) => {
    const nextTime = Math.max(0, Number(time || 0));
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
    onProgressRef.current?.({currentTime: nextTime});
    console.log('[VideoPlayerEvent]', {
      event: 'seekRequested',
      time: nextTime,
      sourceUri: effectiveSourceUri,
      note: 'Windows MediaPlayerElement owns native playback; JS seek is best-effort in this RNW wrapper.',
    });
  }, [effectiveSourceUri]);

  const pause = useCallback(() => {
    setImperativePaused(true);
    console.log('[VideoPlaybackControl]', {
      action: 'pause',
      playerId: props.id,
      targetVideoPath: effectiveSourceUri,
      pausedState: true,
      nativePauseCalled: true,
      nativeStopCalled: false,
      audioMuted: true,
      activePlayerCountAfterAction: 1,
    });
  }, [effectiveSourceUri, props.id]);

  const resume = useCallback(() => {
    setImperativeStopped(false);
    setImperativePaused(false);
    console.log('[VideoPlaybackControl]', {
      action: 'play',
      playerId: props.id,
      targetVideoPath: sourceUri,
      pausedState: false,
      nativePauseCalled: false,
      nativeStopCalled: false,
      audioMuted: false,
      activePlayerCountAfterAction: 1,
    });
  }, [sourceUri, props.id]);

  const stop = useCallback(() => {
    setImperativePaused(true);
    setImperativeStopped(true);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    onProgressRef.current?.({currentTime: 0});
    console.log('[VideoPlaybackControl]', {
      action: 'stop',
      playerId: props.id,
      targetVideoPath: effectiveSourceUri || sourceUri,
      pausedState: true,
      nativePauseCalled: true,
      nativeStopCalled: true,
      audioMuted: true,
      activePlayerCountAfterAction: 0,
    });
  }, [effectiveSourceUri, props.id, sourceUri]);

  useImperativeHandle(
    ref,
    () => ({
      seek,
      pause,
      resume,
      stop,
      presentFullscreenPlayer: () => undefined,
      dismissFullscreenPlayer: () => undefined,
    }),
    [pause, resume, seek, stop],
  );

  useEffect(() => {
    if (!effectiveSourceUri) {
      lastLoadedSourceRef.current = '';
      return;
    }

    if (lastLoadedSourceRef.current === effectiveSourceUri) {
      console.log('[VideoPlayerEvent]', {
        event: 'skipDuplicateSyntheticLoad',
        sourceUri: effectiveSourceUri,
      });
      return;
    }

    lastLoadedSourceRef.current = effectiveSourceUri;
    currentTimeRef.current = 0;
    setCurrentTime(0);

    const syntheticDuration = getSyntheticDuration(startAtTailSeconds, effectiveSourceUri);

    console.log('[VideoPlayerOpen]', {
      originalSource:
        typeof source === 'string'
          ? source
          : source && typeof source === 'object'
            ? source.uri
            : undefined,
      normalizedSource: effectiveSourceUri,
      selectedSourceType: 'fileUri',
      syntheticDuration,
      platform: Platform.OS,
    });

    onLoadStartRef.current?.();
    onBufferRef.current?.({isBuffering: false});
    onLoadRef.current?.({duration: syntheticDuration});
    console.log('[VideoPlayerEvent]', {
      event: 'onLoadSynthetic',
      sourceUri: effectiveSourceUri,
      duration: syntheticDuration,
      note: 'Native Windows player opens local MP4 through StorageFile/CreateFromStorageFile.',
    });
    setTimeout(() => {
      onReadyForDisplayRef.current?.();
      console.log('[VideoPlayerEvent]', {
        event: 'onReadyForDisplaySynthetic',
        sourceUri: effectiveSourceUri,
      });
    }, 0);
  }, [effectiveSourceUri, source, startAtTailSeconds]);

  useEffect(() => {
    if (effectivePaused || !effectiveSourceUri) {
      return undefined;
    }

    const timer = setInterval(() => {
      currentTimeRef.current += 0.5;
      setCurrentTime(currentTimeRef.current);
      onProgressRef.current?.({currentTime: currentTimeRef.current});
    }, 500);

    return () => clearInterval(timer);
  }, [effectivePaused, effectiveSourceUri]);

  useEffect(() => {
    if (Platform.OS !== 'windows') {
      return;
    }

    if (!sourceUri && !imperativeStopped) {
      onErrorRef.current?.({error: 'Missing video source'});
    }
  }, [imperativeStopped, sourceUri]);

  return (
    <View style={[styles.container, style]}>
      <NativeWindowsVideoPlayer
        style={StyleSheet.absoluteFill}
        sourceUri={effectiveSourceUri}
        paused={effectivePaused}
        controls={controls}
        rate={Number(rate || 1)}
        resizeMode={resizeMode}
        startAtTailSeconds={Number(startAtTailSeconds || 0)}
      />
      {!effectiveSourceUri ? props.renderLoader || null : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
});

export default VideoWindows;
export type VideoRef = {
  seek: (time: number) => void;
  pause?: () => void;
  resume?: () => void;
  stop?: () => void;
};
