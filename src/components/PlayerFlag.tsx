import React from 'react';
import {
  Image,
  ImageSourcePropType,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import images from 'assets';

type PlayerLike = {
  countryCode?: string;
  countryName?: string;
  flag?: string;
};

type Props = {
  player?: PlayerLike;
  countryCode?: string;
  countryName?: string;
  flag?: string;
  width?: number;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

const normalize = (value?: string) =>
  String(value || '')
    .trim()
    .toLowerCase();

export const getLocalFlagSource = (
  input?: PlayerLike,
): ImageSourcePropType | null => {
  const code = normalize(input?.countryCode || input?.flag);
  const name = normalize(input?.countryName);

  if (
    code === 'vn' ||
    code === 'vnm' ||
    code === 'vi' ||
    code === 'vietnam' ||
    code === 'viet nam' ||
    code === 'việt nam' ||
    name.includes('vietnam') ||
    name.includes('viet nam') ||
    name.includes('việt nam')
  ) {
    return images.vietnam;
  }

  return null;
};

export const getSafeFlagText = (input?: PlayerLike) => {
  const code = String(input?.countryCode || '').trim().toUpperCase();
  const flag = String(input?.flag || '').trim();

  if (
    code === 'VN' ||
    flag === 'VN' ||
    flag === '🇻🇳' ||
    normalize(flag).includes('vietnam')
  ) {
    return '';
  }

  return flag || code || '';
};

const PlayerFlag = ({
  player,
  countryCode,
  countryName,
  flag,
  width = 34,
  height = 22,
  radius = 4,
  style,
  textStyle,
}: Props) => {
  const target = {
    countryCode: countryCode ?? player?.countryCode,
    countryName: countryName ?? player?.countryName,
    flag: flag ?? player?.flag,
  };

  const source = getLocalFlagSource(target);
  const safeText = getSafeFlagText(target);

  if (source) {
    return (
      <View
        style={[
          styles.frame,
          {
            width,
            height,
            borderRadius: radius,
          },
          style,
        ]}>
        <Image source={source} resizeMode="cover" style={styles.image} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.fallbackFrame,
        {
          width,
          height,
          borderRadius: radius,
        },
        style,
      ]}>
      <Text style={[styles.fallbackText, textStyle]} numberOfLines={1}>
        {safeText || '--'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallbackFrame: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
  },
});

export default PlayerFlag;