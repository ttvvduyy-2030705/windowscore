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

import {
  getFlagImageSource,
  getFlagText,
  normalizePlayerCountry,
} from 'platform/windows/flags';

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

export const getLocalFlagSource = (
  input?: PlayerLike,
): ImageSourcePropType | null => getFlagImageSource(normalizePlayerCountry(input as any));

export const getSafeFlagText = (input?: PlayerLike) =>
  getFlagText(normalizePlayerCountry(input as any));

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
  const target = normalizePlayerCountry({
    countryCode: countryCode ?? player?.countryCode,
    countryName: countryName ?? player?.countryName,
    flag: flag ?? player?.flag,
  });

  const source = getFlagImageSource(target);
  const safeText = getFlagText(target);

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
        <Image source={source} resizeMode="contain" style={styles.image} />
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
