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
      : typeof input?.uri === 'string'
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

  // Native MediaPlayerElement owns actual playback. Until native duration events
  // are bridged, keep this positive so JS controls do not treat a valid local
  // MP4 as a failed zero-duration source.
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
  const currentTimeRef = useRef(0);
  const sourceUri = useMemo(() => normalizeWindowsVideoUri(source), [source]);
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

  const seek = useCallback((time: number) => {
    const nextTime = Math.max(0, Number(time || 0));
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
    onProgressRef.current?.({currentTime: nextTime});
    console.log('[VideoPlayerEvent]', {
      event: 'seekRequested',
      time: nextTime,
      sourceUri,
      note: 'Windows MediaPlayerElement owns native playback; JS seek is best-effort in this RNW wrapper.',
    });
  }, [sourceUri]);

  useImperativeHandle(
    ref,
    () => ({
      seek,
      pause: () => undefined,
      resume: () => undefined,
      presentFullscreenPlayer: () => undefined,
      dismissFullscreenPlayer: () => undefined,
    }),
    [seek],
  );

  useEffect(() => {
    if (!sourceUri) {
      lastLoadedSourceRef.current = '';
      return;
    }

    if (lastLoadedSourceRef.current === sourceUri) {
      console.log('[VideoPlayerEvent]', {
        event: 'skipDuplicateSyntheticLoad',
        sourceUri,
      });
      return;
    }

    lastLoadedSourceRef.current = sourceUri;
    currentTimeRef.current = 0;
    setCurrentTime(0);

    const syntheticDuration = getSyntheticDuration(startAtTailSeconds, sourceUri);

    console.log('[VideoPlayerOpen]', {
      originalSource: typeof source === 'string' ? source : source?.uri,
      normalizedSource: sourceUri,
      selectedSourceType: 'fileUri',
      syntheticDuration,
      platform: Platform.OS,
    });

    onLoadStartRef.current?.();
    onBufferRef.current?.({isBuffering: false});
    onLoadRef.current?.({duration: syntheticDuration});
    console.log('[VideoPlayerEvent]', {
      event: 'onLoadSynthetic',
      sourceUri,
      duration: syntheticDuration,
      note: 'Native Windows player opens local MP4 through StorageFile/CreateFromStorageFile.',
    });
    setTimeout(() => {
      onReadyForDisplayRef.current?.();
      console.log('[VideoPlayerEvent]', {
        event: 'onReadyForDisplaySynthetic',
        sourceUri,
      });
    }, 0);
  }, [sourceUri, source, startAtTailSeconds]);

  useEffect(() => {
    if (paused || !sourceUri) {
      return undefined;
    }

    const timer = setInterval(() => {
      currentTimeRef.current += 0.5;
      setCurrentTime(currentTimeRef.current);
      onProgressRef.current?.({currentTime: currentTimeRef.current});
    }, 500);

    return () => clearInterval(timer);
  }, [paused, sourceUri]);

  useEffect(() => {
    if (Platform.OS !== 'windows') {
      return;
    }

    if (!sourceUri) {
      onErrorRef.current?.({error: 'Missing video source'});
    }
  }, [sourceUri]);

  return (
    <View style={[styles.container, style]}>
      {sourceUri ? (
        <NativeWindowsVideoPlayer
          style={StyleSheet.absoluteFill}
          sourceUri={sourceUri}
          paused={paused}
          controls={controls}
          rate={Number(rate || 1)}
          resizeMode={resizeMode}
          startAtTailSeconds={Number(startAtTailSeconds || 0)}
        />
      ) : (
        props.renderLoader || null
      )}
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
};
export type OnVideoErrorData = any;
