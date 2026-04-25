import React from 'react';
import {requireNativeComponent, StyleProp, ViewStyle} from 'react-native';

type NativeWindowsCameraViewProps = {
  style?: StyleProp<ViewStyle>;
};

const NativeWindowsCameraView = requireNativeComponent<NativeWindowsCameraViewProps>('WindowsCameraView');

const WindowsNativeCameraView = ({style}: NativeWindowsCameraViewProps) => {
  return <NativeWindowsCameraView style={style} />;
};

export default WindowsNativeCameraView;
