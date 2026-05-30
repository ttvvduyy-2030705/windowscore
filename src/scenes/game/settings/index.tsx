import React from 'react';
import {ActivityIndicator, Pressable, ScrollView, Text, TextInput, View} from 'react-native';

import images from 'assets';
import Image from 'components/Image';
import Container from 'components/Container';
import i18n from 'i18n';
import {screens} from 'scenes/screens';

import CategorySettings from './category';
import PlayerSettings from './player';
import GameSettingsViewModel, {Props} from './SettingsViewModel';
import useAdaptiveLayout from '../useAdaptiveLayout';
import useScreenSystemUI from 'theme/systemUI';
import createStyles from './styles';

const getLocale = () => {
  const maybeCurrentLocale =
    typeof (i18n as any)?.currentLocale === 'function'
      ? (i18n as any).currentLocale()
      : '';

  return String((i18n as any)?.locale ?? maybeCurrentLocale ?? '').toLowerCase();
};

const getFallbackLabel = (key: string, vi: string, en: string) => {
  const translated = i18n.t(key as never);
  if (translated && translated !== key && !String(translated).includes('[missing')) {
    return translated as string;
  }

  return getLocale().startsWith('en') ? en : vi;
};

const GameSettings = (props: Props) => {
  useScreenSystemUI({variant: 'fullscreen', barStyle: 'light-content'});
  const viewModel = GameSettingsViewModel(props);
  const adaptive = useAdaptiveLayout();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);
  const isEnglish = getLocale().startsWith('en');

  const translatedTitle = i18n.t(screens.gameSettings as never);
  const title =
    translatedTitle && translatedTitle !== screens.gameSettings && !String(translatedTitle).includes('[missing')
      ? (translatedTitle as string)
      : isEnglish
        ? 'Game Settings'
        : 'Cài đặt trận đấu';

  const configTitle = isEnglish ? 'Mode' : 'Chế độ';
  const playerTitle = isEnglish ? 'Players' : 'Người chơi';

  const cancelText = getFallbackLabel('txtCancel', 'Hủy', 'Cancel');
  const startText = getFallbackLabel('txtStart', 'Bắt đầu', 'Start');

  return (
    <Container style={styles.screen}>

      <View style={styles.headerGlow}>
        <Pressable
          onPress={viewModel.onCancel}
          style={styles.headerBackButton}>
          <View style={styles.headerBackFrame}>
            <View style={styles.headerBackInner}>
  <Image
    source={require('../../../assets/images/logo-back.png')}
    resizeMode="contain"
    style={{width: 18, height: 18, marginRight: 8}}
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
          <Text style={styles.headerTitle}>{title}</Text>
        </View>
      </View>

      <View style={styles.contentRow}>
        <View style={[styles.panelShell, styles.leftPanel]}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelHeaderText}>{configTitle}</Text>
          </View>

          <ScrollView
            style={styles.panelScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.panelScrollContent}>
            <CategorySettings
              adaptive={adaptive}
              showTitle={false}
              category={viewModel.category}
              gameMode={viewModel.gameMode}
              gameSettingsMode={viewModel.gameSettingsMode}
              extraTimeTurnsEnabled={viewModel.extraTimeTurnsEnabled}
              countdownEnabled={viewModel.countdownEnabled}
              warmUpEnabled={viewModel.warmUpEnabled}
              extraTimeBonusEnabled={viewModel.extraTimeBonusEnabled}
              onSelectCategory={viewModel.onSelectCategory}
              onSelectGameMode={viewModel.onSelectGameMode}
              onSelectExtraTimeTurns={viewModel.onSelectExtraTimeTurns}
              onSelectCountdown={viewModel.onSelectCountdown}
              onSelectWarmUp={viewModel.onSelectWarmUp}
              onSelectExtraTimeBonus={viewModel.onSelectExtraTimeBonus}
            />
          </ScrollView>
        </View>

        <View style={[styles.panelShell, styles.rightPanel]}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelHeaderText}>{playerTitle}</Text>
          </View>

          <View style={styles.rightPanelContent}>
            <ScrollView
              style={styles.panelScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.playerScrollContent}>
              <View style={styles.aplusLivePanel}>
                <View style={styles.aplusLiveHeaderRow}>
                  <Text style={styles.aplusLiveTitle}>Kết nối web Aplus</Text>
                  {(viewModel.aplusLoadingTournaments || viewModel.aplusLoadingMatch) ? (
                    <ActivityIndicator color={'#FFFFFF'} size="small" />
                  ) : null}
                </View>

                <View style={styles.aplusLiveRow}>
                  <Pressable
                    onPress={viewModel.onPrevAplusTournament}
                    style={({pressed}) => [
                      styles.aplusMiniButton,
                      pressed && styles.buttonPressed,
                    ]}>
                    <Text style={styles.aplusMiniButtonText}>‹</Text>
                  </Pressable>

                  <View style={styles.aplusTournamentBox}>
                    <Text style={styles.aplusTournamentLabel}>Tên giải</Text>
                    <Text style={styles.aplusTournamentName} numberOfLines={1}>
                      {viewModel.selectedAplusTournament?.name || 'Chưa chọn giải'}
                    </Text>
                  </View>

                  <Pressable
                    onPress={viewModel.onNextAplusTournament}
                    style={({pressed}) => [
                      styles.aplusMiniButton,
                      pressed && styles.buttonPressed,
                    ]}>
                    <Text style={styles.aplusMiniButtonText}>›</Text>
                  </Pressable>

                  <Pressable
                    onPress={viewModel.onLoadAplusTournaments}
                    style={({pressed}) => [
                      styles.aplusReloadButton,
                      pressed && styles.buttonPressed,
                    ]}>
                    <Text style={styles.aplusReloadText}>Tải giải</Text>
                  </Pressable>
                </View>

                <View style={styles.aplusLiveRow}>
                  <TextInput
                    value={viewModel.aplusMatchNumber}
                    onChangeText={viewModel.onChangeAplusMatchNumber}
                    placeholder="Số trận"
                    placeholderTextColor={'rgba(255,255,255,0.45)'}
                    keyboardType="number-pad"
                    style={styles.aplusMatchInput}
                  />

                  <Pressable
                    onPress={viewModel.onLoadAplusMatch}
                    style={({pressed}) => [
                      styles.aplusLoadMatchButton,
                      pressed && styles.buttonPressed,
                    ]}>
                    <Text style={styles.aplusLoadMatchText}>Lấy trận</Text>
                  </Pressable>
                </View>

                <Text style={styles.aplusLiveStatus} numberOfLines={2}>
                  {viewModel.aplusLiveStatus}
                </Text>
              </View>

              <PlayerSettings
                adaptive={adaptive}
                showTitle={false}
                gameMode={viewModel.gameMode}
                category={viewModel.category}
                playerSettings={viewModel.playerSettings}
                onSelectPlayerNumber={viewModel.onSelectPlayerNumber}
                onSelectPlayerGoal={viewModel.onSelectPlayerGoal}
                onChangePlayerName={viewModel.onChangePlayerName}
                onChangePlayerPoint={viewModel.onChangePlayerPoint}
                onSelectPlayerCountry={viewModel.onSelectPlayerCountry}
              />
            </ScrollView>

            <View style={styles.footerInside}>
              <Pressable
                onPress={viewModel.onCancel}
                style={({pressed}) => [
                  styles.footerButton,
                  styles.cancelButton,
                  pressed && styles.buttonPressed,
                ]}>
                <Text style={styles.cancelText}>{cancelText}</Text>
              </Pressable>

              <Pressable
                disabled={viewModel.youtubeLiveLoading}
                onPress={viewModel.onStart}
                style={({pressed}) => [
                  styles.footerButton,
                  styles.startButton,
                  viewModel.youtubeLiveLoading && styles.buttonDisabled,
                  pressed && !viewModel.youtubeLiveLoading && styles.buttonPressed,
                ]}>
                {viewModel.youtubeLiveLoading ? (
                  <ActivityIndicator color={'#FFFFFF'} size="small" />
                ) : (
                  <Text style={styles.startText}>{startText}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      {viewModel.youtubeLiveLoading ? (
        <View style={styles.liveLoadingOverlay} pointerEvents="auto">
          <View style={styles.liveLoadingCard}>
            <ActivityIndicator color={'#FFFFFF'} size="large" />
            <Text style={styles.liveLoadingTitle}>Đang tải phiên live</Text>
            <Text style={styles.liveLoadingMessage}>
              {viewModel.youtubeLiveLoadingMessage || 'Đang chờ YouTube xác nhận live...'}
            </Text>
          </View>
        </View>
      ) : null}
    </Container>
  );
};

export default GameSettings;
