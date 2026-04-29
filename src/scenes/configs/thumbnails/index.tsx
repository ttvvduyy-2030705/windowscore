import React, {memo} from 'react';
import {Switch} from 'react-native';
import {keys} from 'configuration/keys';
import Text from 'components/Text';
import View from 'components/View';
import images from 'assets';
import i18n from 'i18n';
import PickerList from './picker-list';
import ThumbnailsViewModel from './ThumbnailsViewModel';
import styles from './styles';
import {useAplusPro} from 'features/subscription';

const Thumbnails = () => {
  const viewModel = ThumbnailsViewModel();
  const {isAplusProActive} = useAplusPro();
  const premiumLocked = !isAplusProActive;
  return (
    <View style={styles.container}>
      <Text color={'#FFFFFF'} style={styles.title}>{i18n.t('sponsorLogos')}</Text>
      <View style={styles.row}>
        <View style={styles.slotColumn}><Text color={'#A8A8A8'} style={styles.slotTitle}>{i18n.t('txtTopLeft')}</Text><PickerList saveKey={keys.THUMBNAILS_TOP_LEFT} fixedImageSource={images.logoFilled} locked premiumLocked={premiumLocked} /></View>
        <View style={styles.rowGap} />
        <View style={styles.slotColumn}><Text color={'#A8A8A8'} style={styles.slotTitle}>{i18n.t('txtTopRight')}</Text><PickerList saveKey={keys.THUMBNAILS_TOP_RIGHT} premiumLocked={premiumLocked} /></View>
      </View>
      <View style={[styles.row,{marginTop:16}]}>
        <View style={styles.slotColumn}><Text color={'#A8A8A8'} style={styles.slotTitle}>{i18n.t('txtBottomLeft')}</Text><PickerList saveKey={keys.THUMBNAILS_BOTTOM_LEFT} premiumLocked={premiumLocked} /></View>
        <View style={styles.rowGap} />
        <View style={styles.slotColumn}><Text color={'#A8A8A8'} style={styles.slotTitle}>{i18n.t('txtBottomRight')}</Text><PickerList saveKey={keys.THUMBNAILS_BOTTOM_RIGHT} premiumLocked={premiumLocked} /></View>
      </View>
      <View style={styles.toggleRow}>
        <Text color={'#FFFFFF'} style={styles.toggleLabel}>{i18n.t('showOnLiveStream')}</Text>
        {typeof viewModel.showOnLiveStream === 'boolean' ? <Switch value={viewModel.showOnLiveStream} onValueChange={viewModel.onToggleShowOnLiveStream} trackColor={{false:'#2A2A2A', true:'#C91D24'}} thumbColor={viewModel.showOnLiveStream ? '#FFFFFF' : '#BDBDBD'} /> : <View />}
      </View>
    </View>
  );
};
export default memo(Thumbnails);
