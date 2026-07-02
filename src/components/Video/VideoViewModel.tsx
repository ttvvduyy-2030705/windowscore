import type {ReactNode} from 'react';
import {Ref, RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {Gesture} from 'react-native-gesture-handler';
import {useAnimatedStyle, useSharedValue} from 'react-native-reanimated';

import {
  OnBufferData,
  OnLoadData,
  OnSeekData,
  OnVideoErrorData,
  OnVideoTracksData,
  ReactVideoSourceProperties,
} from 'react-native-video';
import { Camera } from 'react-native-vision-camera';

export interface Props {
  gestureDisabled?: boolean;
  loadingDisabled?: boolean;
  source:
    | Readonly<
        Omit<ReactVideoSourceProperties, 'uri'> & {
          uri?: string | NodeRequire;
          rtspCandidates?: string[];
        }
      >
    | undefined;
  initialScale?: number;
  initialTranslateX?: number;
  initialTranslateY?: number;
  onFullscreenPlayerDidPresent?: (() => void) | undefined;
  onBuffer?: ((e: OnBufferData) => void) | undefined;
  onSeek?: ((e: OnSeekData) => void) | undefined;
  onLoad?: ((e: OnLoadData) => void) | undefined;
  onVideoTracks?: ((e: OnVideoTracksData) => void) | undefined;
  onEnd?: (() => void) | undefined;
  onError?: ((e: OnVideoErrorData) => void) | undefined;
  onPosition?: (scale: number, translateX: number, translateY: number) => void;
  cameraRef? : RefObject<Camera>;
  isStarted: boolean;
  isPaused :boolean;
  isPreview?: boolean;
  videoUri?:  string;
  webcamType : string;
  setIsCameraReady: ((isReady: boolean) => void);
  overlayContent?: ReactNode;
  cameraScaleMode?: 'contain' | 'cover';
  androidPreviewViewTypeOverride?: 'surface-view' | 'texture-view' | 'default';
  suppressCameraFallbackOverlay?: boolean;
  ignoreNavigationFocusLoss?: boolean;
}

const VideoViewModel = (props: Props) => {
  const offset = useSharedValue<number>(1);
  const translateX = useSharedValue<number>(0);
  const translateY = useSharedValue<number>(0);
  const [webcamType, setWebcamType] = useState<string>(props.webcamType);

  useEffect(() => {
    return () => {
      if (props.onPosition) {
        props.onPosition(offset.value, translateX.value, translateY.value);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pinch = Gesture.Pinch()
    .enabled(!props.gestureDisabled)
    .onChange(event => {
      offset.value = event.scale;
    })
    .onFinalize(event => {
      switch (true) {
        case event.scale < 0.5:
          offset.value = 0.5;
          break;
        case event.scale > 2:
          offset.value = 2;
          break;
      }
    });

  const pan = Gesture.Pan()
    .enabled(!props.gestureDisabled)
    .onChange(event => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
    })
    .onFinalize(event => {
      if (event.translationX > 150) {
        translateX.value = 150;
      }

      if (event.translationX < -150) {
        translateX.value = -150;
      }

      if (event.translationY > 150) {
        translateY.value = 150;
      }

      if (event.translationY < -150) {
        translateY.value = -150;
      }
    });

  const gestureComposed = Gesture.Simultaneous(pan, pinch);

  const animatedStyles = useAnimatedStyle(
    () => ({
      transform: [
        {scale: offset.value},
        {translateX: translateX.value},
        {translateY: translateY.value},
      ],
    }),
    [],
  );

  const onFullscreenPlayerDidPresent = useCallback(() => {
    if (!props.onFullscreenPlayerDidPresent) {
      return;
    }

    props.onFullscreenPlayerDidPresent();
  }, [props]);

  const onBuffer = useCallback(
    (e: OnBufferData) => {
      if (!props.onBuffer) {
        return;
      }

      props.onBuffer(e);
    },
    [props],
  );

  const onSeek = useCallback(
    (e: OnSeekData) => {
      if (!props.onSeek) {
        return;
      }

      props.onSeek(e);
    },
    [props],
  );

  const onLoad = useCallback(
    (e: OnLoadData) => {
      offset.value = props.initialScale || 1;
      translateX.value = props.initialTranslateX || 0;
      translateY.value = props.initialTranslateY || 0;

      if (!props.onLoad) {
        return;
      }

      props.onLoad(e);
    },
    [props, offset, translateX, translateY],
  );

  const onVideoTracks = useCallback(
    (e: OnVideoTracksData) => {
      if (!props.onVideoTracks) {
        return;
      }

      props.onVideoTracks(e);
    },
    [props],
  );

  const onEnd = useCallback(() => {
    if (!props.onEnd) {
      return;
    }

    props.onEnd();
  }, [props]);

  const onError = useCallback(
    (e: OnVideoErrorData) => {
      if (!props.onError) {
        return;
      }

      props.onError(e);
    },
    [props],
  );

  const onReadyForDisplay = useCallback(() => {}, []);

  return useMemo(() => {
    return {
      pinch,
      pan,
      gestureComposed,
      animatedStyles,
      onReadyForDisplay,
      onFullscreenPlayerDidPresent,
      onBuffer,
      onSeek,
      onLoad,
      onVideoTracks,
      onEnd,
      onError,
      webcamType,
    };
  }, [
    pinch,
    pan,
    gestureComposed,
    animatedStyles,
    onReadyForDisplay,
    onFullscreenPlayerDidPresent,
    onBuffer,
    onSeek,
    onLoad,
    onVideoTracks,
    onEnd,
    onError,
    webcamType,
    props.setIsCameraReady,
  ]);
};

export default VideoViewModel;
