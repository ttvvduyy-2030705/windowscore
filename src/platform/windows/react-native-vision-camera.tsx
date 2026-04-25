import React from 'react';
import {View} from 'react-native';

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
    </View>
  );
});

(Camera as any).getAvailableCameraDevices = async () => [];
(Camera as any).requestCameraPermission = async () => 'granted';
(Camera as any).getCameraPermissionStatus = async () => 'granted';
(Camera as any).requestMicrophonePermission = async () => 'granted';
(Camera as any).getMicrophonePermissionStatus = async () => 'granted';

const WINDOWS_CAMERA_DEVICE: any = {
  id: 'windows-camera-placeholder',
  name: 'Windows Camera',
  position: 'back',
};

export function useCameraDevice() {
  return WINDOWS_CAMERA_DEVICE;
}

export function useCameraDevices() {
  return [WINDOWS_CAMERA_DEVICE];
}

export function useFrameProcessor() {
  return undefined;
}

export default Camera;