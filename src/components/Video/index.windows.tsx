import React, {forwardRef, useEffect, useImperativeHandle} from 'react';
import {Image, StyleSheet, View} from 'react-native';

import images from 'assets';

type Props = {
  style?: any;
  children?: React.ReactNode;
  setIsCameraReady?: (isReady: boolean) => void;
};

const VideoWindows = forwardRef<any, Props>((props, ref) => {
  const {setIsCameraReady} = props;

  useImperativeHandle(ref, () => ({
    startRecording: async () => null,
    stopRecording: async () => null,
    startLive: async () => false,
    stopLive: async () => false,
    setZoom: async () => 1,
    getZoomInfo: async () => ({
      supported: false,
      minZoom: 1,
      maxZoom: 1,
      zoom: 1,
      source: 'windows',
    }),
  }));

  useEffect(() => {
    setIsCameraReady?.(false);
  }, [setIsCameraReady]);

  return (
    <View style={[styles.container, props.style]}>
      <Image
        source={images.logoSmall || images.logoFilled || images.logo}
        resizeMode="contain"
        style={styles.logo}
      />
      {props.children}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  logo: {
    width: '34%',
    height: '34%',
    minWidth: 96,
    minHeight: 54,
    maxWidth: 240,
    maxHeight: 136,
  },
});

export default VideoWindows;
