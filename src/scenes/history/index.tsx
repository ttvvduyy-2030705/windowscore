import React, {memo, useCallback, useContext, useMemo} from 'react';
import {FlatList, Pressable} from 'react-native';
import dayjs from 'dayjs';
import images from 'assets';
import Image from 'components/Image';
import Container from 'components/Container';
import Button from 'components/Button';
import Text from 'components/Text';
import View from 'components/View';
import colors from 'configuration/colors';
import i18n from 'i18n';
import {Player} from 'types/player';
import {GameSettings} from 'types/settings';
import {DAY_FORMAT, TIME_FORMAT} from 'utils/date';
import HistoryViewModel from './HistoryViewModel';
import createStyles from './styles';
import useAdaptiveLayout from 'scenes/game/useAdaptiveLayout';
import useScreenSystemUI from 'theme/systemUI';
import {LanguageContext} from 'context/language';

const getTextColor = (hex?: string) => {
  const value = String(hex || '').replace('#', '');
  if (value.length !== 6) { return '#111111'; }
  const r = parseInt(value.slice(0, 2), 16); const g = parseInt(value.slice(2, 4), 16); const b = parseInt(value.slice(4, 6), 16); const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255; return luminance > 0.7 ? '#111111' : '#FFFFFF';
};

const History = (props: any) => {
  useScreenSystemUI({variant: 'fullscreen', barStyle: 'light-content'});
  const {language} = useContext(LanguageContext);
  const viewModel = HistoryViewModel();
  const adaptive = useAdaptiveLayout();
  const styles = useMemo(() => createStyles(adaptive), [adaptive.styleKey]);
  const title = useMemo(() => { const t = i18n.t('txtHistory'); return t && t !== 'history' ? (t as string) : i18n.t('txtHistory') as string; }, [language]);
  const onBack = useCallback(() => { if (typeof props?.goBack === 'function') { props.goBack(); return; } if (typeof props?.navigation?.goBack === 'function') { props.navigation.goBack(); } }, [props]);

  const renderPlayer = useCallback((player: Player, index: number) => {
    const textColor = getTextColor(player.color);
    return <View key={`player-${index}`} style={[styles.player, {backgroundColor: player.color || colors.white}]}><Text color={textColor} style={[styles.playerName, {color: textColor}]}>{player.name}</Text><Text color={textColor} style={[styles.playerPoint, {color: textColor}]}>{player.totalPoint}</Text></View>;
  }, [styles]);

  const renderItem = useCallback(({item, index}: {item: GameSettings; index: number}) => (
    <View key={`history-${index}`} style={styles.item}>
      <View style={styles.itemRow}>
        <View style={styles.itemColumn}>
          <Text color={'#9D9D9D'} style={styles.itemMeta}>{i18n.t('category')}</Text><Text color={'#FFFFFF'} style={styles.itemValue}>{viewModel.buildCategoryTitle(item)}</Text>
          <View style={{height: adaptive.s(10)}} />
          <Text color={'#9D9D9D'} style={styles.itemMeta}>{i18n.t('mode')}</Text><Text color={'#FFFFFF'} style={styles.itemValue}>{viewModel.buildModeTitle(item)}</Text>
          <View style={{height: adaptive.s(10)}} />
          <Text color={'#9D9D9D'} style={styles.itemMeta}>{i18n.t('time')}</Text><Text color={'#FFFFFF'} style={styles.itemValue}>{dayjs(item.updatedAt).format(TIME_FORMAT)}</Text>
          <View style={{height: adaptive.s(10)}} />
          <Text color={'#9D9D9D'} style={styles.itemMeta}>{i18n.t('txtDate')}</Text><Text color={'#FFFFFF'} style={styles.itemValue}>{dayjs(item.updatedAt).format(DAY_FORMAT)}</Text>
          <View style={{height: adaptive.s(10)}} />
          <Text color={'#9D9D9D'} style={styles.itemMeta}>{i18n.t('playingTime')}</Text><Text color={'#FFFFFF'} style={styles.itemValue}>{item.totalTime} {i18n.t('txtSecond')}</Text>
        </View>
        <View style={[styles.itemColumn, styles.playerWrap]}>{item.players.playingPlayers.map(renderPlayer)}</View>
        <View style={[styles.itemColumn, styles.actionColumn]}>
          <Button style={styles.button} onPress={viewModel.onReWatchGame.bind(History, item.webcamFolderName)}><Text color={'#FFFFFF'} style={styles.buttonText}>{i18n.t('reWatch')}</Text></Button>
          <Button style={styles.buttonDelete} onPress={viewModel.onDeleteGame.bind(History, item)}><Image source={images.delete} style={styles.icon} /></Button>
        </View>
      </View>
    </View>
  ), [adaptive, renderPlayer, viewModel, language]);

  return (
    <Container style={styles.screen}>
      <View style={styles.headerGlow}>
        <Pressable
          onPress={onBack}
          style={styles.headerBackButton}>
          <View style={styles.headerBackFrame}>
            <View style={styles.headerBackInner}>
  <Image
    source={require('../../assets/images/logo-back.png')}
    resizeMode="contain"
    style={{width: adaptive.s(18), height: adaptive.s(18), marginRight: adaptive.s(8)}}
  />
  <Image
    source={images.logoSmall || images.logo}
    resizeMode="contain"
    style={styles.headerBackLogoImage}
  />
</View>
          </View>
        </Pressable>

        <View pointerEvents="none" style={styles.headerTitleWrap}>
          <Text color={'#FFFFFF'} style={styles.headerTitle}>{title}</Text>
        </View>
      </View>
      <FlatList data={viewModel.games} renderItem={renderItem} removeClippedSubviews keyExtractor={(_item,index)=>`history-${index}`} contentContainerStyle={styles.listContent} ListEmptyComponent={<View style={styles.emptyWrap}><Text color={'#FFFFFF'} style={styles.emptyTitle}>{i18n.t('txtNoData')}</Text><Text color={'#888888'} style={styles.emptyText}>{i18n.t('txtHistoryEmptyDescription')}</Text></View>} />
    </Container>
  );
};

export default memo(History);
