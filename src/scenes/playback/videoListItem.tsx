import React, {useMemo} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';

import useDesignSystem from 'theme/useDesignSystem';

import createStyles from './styles';

export interface VideoListItemProps {
  index: number;
  time?: string;
  path: string;
  onPress: (index: number) => void;
  currentIndex: number;
}

const VideoListItem = (props: VideoListItemProps) => {
  const {adaptive, design} = useDesignSystem();
  const styles = useMemo(
    () => createStyles(adaptive, design),
    [adaptive.styleKey, design],
  );

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
        <Text style={styles.duration}>{props.time}</Text>
      </View>
    </TouchableOpacity>
  );
};

export default VideoListItem;
