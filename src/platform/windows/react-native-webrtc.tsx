import React from 'react';
import {Text, View} from 'react-native';

export class RTCPeerConnection {
  addEventListener() {}
  removeEventListener() {}
  addTrack() {}
  close() {}
  createOffer = async () => ({});
  createAnswer = async () => ({});
  setLocalDescription = async () => undefined;
  setRemoteDescription = async () => undefined;
  addIceCandidate = async () => undefined;
}

export class RTCSessionDescription {
  constructor(public value: any) {}
}

export class RTCIceCandidate {
  constructor(public value: any) {}
}

export const mediaDevices = {
  getUserMedia: async () => {
    throw new Error('WebRTC camera/microphone chưa hỗ trợ trong bản Windows này.');
  },
  enumerateDevices: async () => [],
};

export const RTCView = (props: any) => {
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
      <Text style={{color: '#fff'}}>WebRTC Windows chưa được kích hoạt</Text>
    </View>
  );
};

export default {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  RTCView,
};
