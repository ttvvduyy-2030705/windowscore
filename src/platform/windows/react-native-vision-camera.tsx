import React from 'react';
import {Image, StyleSheet, View} from 'react-native';

import images from 'assets';

const buildDevice = (position: 'back' | 'front') => ({
  id: `windows-${position}`,
  name: position === 'front' ? 'Windows Front Camera' : 'Windows Camera',
  position,
  physicalDevices: ['wide-angle-camera'],
  formats: [],
  minZoom: 1,
  maxZoom: 1,
  neutralZoom: 1,
  supportsLowLightBoost: false,
  supportsFocus: false,
  supportsRawCapture: false,
  hardwareLevel: 'limited',
});

const devices = [buildDevice('back'), buildDevice('front')];

export const Camera = React.forwardRef<any, any>((props, ref) => {
  React.useImperativeHandle(ref, () => ({
    startRecording: (options?: any) => {
      const path = String(options?.path || `C:/AplusScoreWindows/ReplayBuffer/windows_${Date.now()}.mp4`);
      (globalThis as any).__APLUS_CAMERA_RECORDING_SNAPSHOT__ = {
        state: 'recording',
        activeBackend: 'windows-fallback',
        source: props?.device?.position === 'front' ? 'front' : 'back',
        isRecording: true,
      };
      (globalThis as any).__APLUS_LAST_WINDOWS_RECORDING__ = {path, options};
    },
    stopRecording: async () => {
      const last = (globalThis as any).__APLUS_LAST_WINDOWS_RECORDING__;
      (globalThis as any).__APLUS_CAMERA_RECORDING_SNAPSHOT__ = {
        state: 'idle',
        activeBackend: null,
        source: props?.device?.position === 'front' ? 'front' : 'back',
        isRecording: false,
      };
      setTimeout(() => {
        last?.options?.onRecordingFinished?.({path: last?.path});
      }, 0);
      return last?.path;
    },
    takePhoto: async () => undefined,
  }));

  React.useEffect(() => {
    if (!props?.isActive) {
      props?.onStopped?.();
      props?.onPreviewStopped?.();
      return;
    }

    props?.onInitialized?.();
    props?.onStarted?.();
    const timeout = setTimeout(() => {
      props?.onPreviewStarted?.();
    }, 50);

    return () => clearTimeout(timeout);
  }, [props?.isActive, props?.device?.id]);

  return (
    <View style={[styles.container, props?.style]}>
      <Image
        source={images.logoSmall || images.logoFilled || images.logo}
        resizeMode="contain"
        style={styles.logo}
      />
    </View>
  );
});

(Camera as any).getAvailableCameraDevices = async () => devices;
(Camera as any).addCameraDevicesChangedListener = () => ({remove: () => undefined});
(Camera as any).getCameraPermissionStatus = async () => 'granted';
(Camera as any).getMicrophonePermissionStatus = async () => 'granted';
(Camera as any).getLocationPermissionStatus = async () => 'granted';
(Camera as any).requestCameraPermission = async () => 'granted';
(Camera as any).requestMicrophonePermission = async () => 'granted';
(Camera as any).requestLocationPermission = async () => 'granted';

export const useCameraDevice = (position: 'back' | 'front' | string) => {
  return devices.find(device => device.position === position) || devices[0];
};

export const useCameraFormat = () => undefined;
export const useCameraDevices = () => devices;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
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
