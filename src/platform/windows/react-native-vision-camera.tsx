import React from 'react';
import {Text, View} from 'react-native';

export const Camera = React.forwardRef<any, any>((props, ref) => {
  React.useImperativeHandle(ref, () => ({
    startRecording: () => undefined,
    stopRecording: async () => undefined,
    takePhoto: async () => undefined,
  }));

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: '#000',
          alignItems: 'center',
          justifyContent: 'center',
        },
        props?.style,
      ]}>
      <Text style={{color: '#fff', fontSize: 14}}>
        Camera Windows chưa được kích hoạt
      </Text>
    </View>
  );
});

(Camera as any).getAvailableCameraDevices = async () => [];
(Camera as any).requestCameraPermission = async () => 'granted';
(Camera as any).getCameraPermissionStatus = async () => 'granted';
(Camera as any).requestMicrophonePermission = async () => 'granted';
(Camera as any).getMicrophonePermissionStatus = async () => 'granted';

export function useCameraDevice() {
  return undefined;
}

export function useCameraDevices() {
  return [];
}

export function useFrameProcessor() {
  return undefined;
}

export default Camera;