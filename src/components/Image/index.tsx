import React, {memo, useCallback, useEffect, useMemo, useState} from 'react';
import {
  Image,
  ImageSourcePropType,
  ImageStyle,
  ImageResizeMode,
} from 'react-native';

import images from 'assets';

import styles from './styles';

interface Props {
  style?: ImageStyle | ImageStyle[];
  source: ImageSourcePropType;
  resizeMode?: ImageResizeMode;
  blurRadius?: number;
}

const CustomImage = (props: Props) => {
  const {source, resizeMode, style, blurRadius} = props;

  const [internalSource, setInternalSource] = useState<
    ImageSourcePropType | number
  >(source || images.default);

  useEffect(() => {
    setInternalSource(source || images.default);
  }, [source]);

  const onError = useCallback((e: any) => {
    console.log('Image error', e?.nativeEvent || e);
    setInternalSource(images.default);
  }, []);

  const internalStyle = useMemo(() => {
    if (style) {
      return style;
    }

    return styles.defaultImage;
  }, [style]);

  return (
    <Image
      source={internalSource}
      style={internalStyle}
      resizeMode={resizeMode}
      blurRadius={blurRadius}
      fadeDuration={0}
      onError={onError}
    />
  );
};

export default memo(CustomImage);
