import React from 'react';
import {Text, View} from 'react-native';

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
          backgroundColor: '#000',
          alignItems: 'center',
          justifyContent: 'center',
        },
        props?.style,
      ]}>
      <Text style={{color: '#fff'}}>Video Windows chưa được kích hoạt</Text>
    </View>
  );
});

export default Video;