import React, {
  forwardRef,
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
  onProgress?: (data: {currentTime: number}) => void;
  onEnd?: () => void;
  onError?: (error: any) => void;
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
    return raw.replace(/\\/g, '/');
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

const VideoWindows = forwardRef<any, WindowsVideoProps>((props, ref) => {
  const {
    source,
    style,
    resizeMode = 'contain',
    paused = false,
    controls = false,
    rate = 1,
    onLoad,
    onProgress,
    onEnd,
    onError,
    startAtTailSeconds = 0,
  } = props;

  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);
  const sourceUri = useMemo(() => normalizeWindowsVideoUri(source), [source]);

  useImperativeHandle(
    ref,
    () => ({
      seek: (time: number) => {
        const nextTime = Math.max(0, Number(time || 0));
        currentTimeRef.current = nextTime;
        setCurrentTime(nextTime);
        onProgress?.({currentTime: nextTime});
        console.log('[Replay] seek requested on Windows native player', {
          time: nextTime,
          note: 'MediaPlayerElement receives the file source; precise seek is best-effort in this RNW wrapper.',
        });
      },
      pause: () => undefined,
      resume: () => undefined,
      presentFullscreenPlayer: () => undefined,
      dismissFullscreenPlayer: () => undefined,
    }),
    [onProgress],
  );

  useEffect(() => {
    if (!sourceUri) {
      return;
    }

    console.log('[Replay] normalizedUri =', sourceUri);
    onLoad?.({duration: 0});
    currentTimeRef.current = 0;
    setCurrentTime(0);
  }, [onLoad, sourceUri]);

  useEffect(() => {
    if (paused || !sourceUri) {
      return undefined;
    }

    const timer = setInterval(() => {
      currentTimeRef.current += 0.5;
      setCurrentTime(currentTimeRef.current);
      onProgress?.({currentTime: currentTimeRef.current});
    }, 500);

    return () => clearInterval(timer);
  }, [onProgress, paused, sourceUri]);

  useEffect(() => {
    if (Platform.OS !== 'windows') {
      return;
    }

    if (!sourceUri) {
      onError?.({error: 'Missing video source'});
    }
  }, [onError, sourceUri]);

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
