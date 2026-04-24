import React, {forwardRef, useImperativeHandle} from 'react';
import {StyleSheet, Text, View} from 'react-native';

type Props = {
  style?: any;
  children?: React.ReactNode;
};

const VideoWindows = forwardRef<any, Props>((props, ref) => {
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

  return (
    <View style={[styles.container, props.style]}>
      <Text style={styles.title}>APlus Score Windows</Text>
      <Text style={styles.text}>
        Camera, UVC recording và YouTube native live hiện là Android-only.
      </Text>
      <Text style={styles.text}>
        Gameplay, scoreboard và luồng màn hình vẫn được giữ cho bản Windows.
      </Text>
      {props.children}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050505',
    padding: 16,
  },
  title: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 18,
    marginBottom: 8,
  },
  text: {
    color: '#cccccc',
    textAlign: 'center',
    fontSize: 13,
    marginTop: 4,
  },
});

export default VideoWindows;