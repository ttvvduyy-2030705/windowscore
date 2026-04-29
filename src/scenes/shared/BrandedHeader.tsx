import React, {memo, useMemo} from 'react';
import {Pressable, useWindowDimensions} from 'react-native';

import images from 'assets';
import Image from 'components/Image';
import Text from 'components/Text';
import View from 'components/View';
import {getLegacyAdaptiveMeta} from 'utils/adaptive';

import createBrandedScreenChrome from './createBrandedScreenChrome';

type Props = {
  title: string;
  onBack?: () => void;
};

const BrandedHeader = ({title, onBack}: Props) => {
  const {width, height, fontScale} = useWindowDimensions();
  const adaptive = useMemo(() => getLegacyAdaptiveMeta(width, height, fontScale), [width, height, fontScale]);
  const chrome = useMemo(() => createBrandedScreenChrome(adaptive), [adaptive.styleKey]);

  return (
    <View style={chrome.headerGlow}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          style={chrome.headerBackButton}>
          <View style={chrome.headerBackFrame}>
            <View style={chrome.headerBackInner}>
              <Image
                source={require('../../assets/images/logo-back.png')}
                resizeMode="contain"
                style={{width: adaptive.s(18), height: adaptive.vs(18), marginRight: adaptive.ms(8)}}
              />
              <Image source={images.logoSmall || images.logo} resizeMode="contain" style={chrome.headerBackLogoImage} />
            </View>
          </View>
        </Pressable>
      ) : null}
      <View pointerEvents="none" style={chrome.headerTitleWrap}>
        <Text color={'#FFFFFF'} style={chrome.headerTitle}>{title}</Text>
      </View>
    </View>
  );
};

export default memo(BrandedHeader);
