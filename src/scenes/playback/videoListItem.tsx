import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';

import {responsiveDimension} from 'utils/helper';

import styles from './styles';

export interface VideoListItemProps {
  index: number;
  time?: string;
  path: string;
  onPress: (index: number) => void;
  currentIndex: number;
}

const thumbnailSize = responsiveDimension(40);

const VideoListItem = (props: VideoListItemProps) => {
  return (
    <TouchableOpacity
      style={[
        styles.itemContainer,
        props.index === props.currentIndex
          ? styles.selectITem
          : styles.unselectItem,
      ]}
      onPress={() => {
        props.onPress(props.index);
      }}>
      <View style={styles.details}>
        <View
          style={[
            styles.thumbnailPlaceholder,
            {width: thumbnailSize, height: thumbnailSize},
          ]}>
          <Text style={styles.thumbnailIndex}>{props.index + 1}</Text>
        </View>
        <Text style={styles.duration}>{props.time}</Text>
      </View>
    </TouchableOpacity>
  );
};

export default VideoListItem;
