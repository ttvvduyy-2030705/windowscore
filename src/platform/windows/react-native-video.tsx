import React from 'react';
import {View} from 'react-native';

export const SelectedVideoTrackType = {
  INDEX: 'index',
  AUTO: 'auto',
  DISABLED: 'disabled',
};

export const ResizeMode = {
  CONTAIN: 'contain',
  COVER: 'cover',
  STRETCH: 'stretch',
  CENTER: 'center',
};

export type BufferConfig = any;
export type OnBufferData = any;
export type OnLoadData = any;
export type OnSeekData = any;
export type OnVideoErrorData = any;
export type OnVideoTracksData = any;

const Video = React.forwardRef<any, any>((props, ref) => {
  React.useImperativeHandle(ref, () => ({
    seek: () => undefined,
    presentFullscreenPlayer: () => undefined,
    dismissFullscreenPlayer: () => undefined,
  }));

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: '#000000',
        },
        props?.style,
      ]}
    />
  );
});

export default Video;
