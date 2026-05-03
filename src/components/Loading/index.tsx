import React, {memo, useMemo} from 'react';
import {ViewStyle, ActivityIndicator} from 'react-native';
import View from 'components/View';
import Image from 'components/Image';
import images from 'assets';
import colors from 'configuration/colors';

import styles from './styles';

interface LoadingProps {
  isLoading: boolean;
  size?: number | 'small' | 'large';
  style?: ViewStyle | ViewStyle[];
  showPlainLoading?: boolean;
}

const Loading = (props: LoadingProps) => {
  const {isLoading = false, size, style, showPlainLoading = false} = props;

  const imageStyle: any = useMemo(() => {
    if (style) {
      if (size === 'small' || size === 'large') {
        return [styles[`loading_${size}`], style];
      }

      return [styles.loading, style];
    }

    if (size === 'small' || size === 'large') {
      return [styles[`loading_${size}`]];
    }

    return styles.loading;
  }, [size, style]);

  if (!isLoading) {
    return <View />;
  }

  if (showPlainLoading) {
    return <ActivityIndicator color={colors.primary} size={size} />;
  }

  return (
    <Image
      source={images.logoSmall}
      style={imageStyle}
      resizeMode={'contain'}
    />
  );
};

export default memo(Loading);
