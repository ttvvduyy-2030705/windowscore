import React, {memo, useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, Image, Pressable, Text, TextInput, View} from 'react-native';
import Modal from 'components/WindowsModal';

import i18n from 'i18n';
import {isPool15OnlyGame, isPoolGame} from 'utils/game';
import {
  PLAYER_NUMBER,
  PLAYER_NUMBER_POOL,
  PLAYER_NUMBER_POOL_15,
  PLAYER_POINT_STEPS,
} from 'constants/player';
import {BilliardCategory} from 'types/category';
import {Player, PlayerNumber, PlayerSettings} from 'types/player';
import {GameMode} from 'types/settings';

import {
  COUNTRIES,
  CountryItem,
  getCountryFlagImageUri,
  normalizeCountryName,
} from './countries';
import useAdaptiveLayout from '../../useAdaptiveLayout';
import {configureSystemUI} from 'theme/systemUI';
import createStyles from './styles';
import {useAplusPro} from 'features/subscription';

interface Props {
  adaptive?: ReturnType<typeof useAdaptiveLayout>;
  showTitle?: boolean;
  gameMode?: GameMode;
  category: BilliardCategory;
  playerSettings: PlayerSettings;
  onSelectPlayerNumber: (playerNumber: PlayerNumber) => void;
  onSelectPlayerGoal: (addedPoint: number, index: number) => void;
  onChangePlayerName: (newName: string, index: number) => void;
  onChangePlayerPoint: (addedPoint: number, index: number, type: number) => void;
  onSelectPlayerCountry: (country: CountryItem, index: number) => void;
}

const getLocale = () => {
  const maybeCurrentLocale =
    typeof (i18n as any)?.currentLocale === 'function'
      ? (i18n as any).currentLocale()
      : '';

  return String((i18n as any)?.locale ?? maybeCurrentLocale ?? '').toLowerCase();
};

const isRemoteUri = (value?: string) => /^https?:\/\//i.test(String(value || '').trim());

const getPlayerFlagImageUri = (player?: {countryCode?: string; flag?: string}) => {
  const fromCode = getCountryFlagImageUri(player?.countryCode, 160);
  if (fromCode) {
    return fromCode;
  }

  const rawFlag = String(player?.flag || '').trim();
  return isRemoteUri(rawFlag) ? rawFlag : '';
};

const getPlayerFlagText = (player?: {flag?: string}) => {
  const rawFlag = String(player?.flag || '').trim();
  return isRemoteUri(rawFlag) ? '' : rawFlag;
};

const EditablePlayerNameInput = memo(
  ({
    value,
    index,
    isPool,
    placeholder,
    onCommit,
    inputStyle,
    editable,
    onBlockedPress,
  }: {
    value: string;
    index: number;
    isPool: boolean;
    placeholder: string;
    inputStyle: any[];
    onCommit: (newName: string, index: number) => void;
    editable: boolean;
    onBlockedPress: () => void;
  }) => {
    const [draftName, setDraftName] = useState(value || '');

    useEffect(() => {
      setDraftName(value || '');
    }, [value]);

    const commitName = useCallback(() => {
      if (!editable) {
        setDraftName(value || '');
        return;
      }

      const trimmedName = String(draftName || '').trim();
      const nextName = trimmedName || value || '';

      setDraftName(nextName);
      if (nextName !== value) {
        onCommit(nextName, index);
      }
    }, [draftName, editable, index, onCommit, value]);

    if (!editable) {
      return (
        <Pressable
          onPress={onBlockedPress}
          hitSlop={8}
          style={({pressed}) => [
            {flex: 1, minWidth: 0},
            pressed && {opacity: 0.82},
          ]}>
          <View pointerEvents="none" style={{flex: 1, minWidth: 0}}>
            <TextInput
              value={draftName}
              editable={false}
              style={inputStyle}
              autoCorrect={false}
              autoCapitalize="words"
              selectTextOnFocus={false}
                  placeholder={placeholder}
              placeholderTextColor={isPool ? '#575757' : '#666666'}
            />
          </View>
        </Pressable>
      );
    }

    return (
      <TextInput
        value={draftName}
        onChangeText={setDraftName}
        onEndEditing={commitName}
        onBlur={commitName}
        style={inputStyle}
        autoCorrect={false}
        autoCapitalize="words"
        editable={true}
        selectTextOnFocus={true}
        placeholder={placeholder}
        placeholderTextColor={isPool ? '#575757' : '#666666'}
      />
    );
  },
);

const PlayerSettingsComponent = ({
  adaptive: adaptiveProp,
  showTitle = true,
  gameMode,
  category,
  playerSettings,
  onSelectPlayerNumber,
  onSelectPlayerGoal,
  onChangePlayerName,
  onChangePlayerPoint,
  onSelectPlayerCountry,
}: Props) => {
  const adaptive = adaptiveProp ?? useAdaptiveLayout();
  const {isAplusProActive, showPaywall} = useAplusPro();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);
  const isPool = useMemo(() => isPoolGame(category), [category]);
  const isEnglish = getLocale().startsWith('en');
  const [countryModalVisible, setCountryModalVisible] = useState(false);
  const [countryKeyword, setCountryKeyword] = useState('');
  const [countryPlayerIndex, setCountryPlayerIndex] = useState<number | null>(
    null,
  );

  const reapplyFullscreenSystemUI = useCallback(() => {
    configureSystemUI({
      animated: false,
      barStyle: 'light-content',
      backgroundColor: 'transparent',
    });
  }, []);

  const translate = useCallback(
    (lookup: string, vi: string, en: string) => {
      const translated = i18n.t(lookup as never);
      if (translated && translated !== lookup && !String(translated).includes('[missing')) {
        return translated as string;
      }
      return isEnglish ? en : vi;
    },
    [isEnglish],
  );

  const title = isEnglish ? 'Players' : 'Người chơi';

  const playerNumberOptions = useMemo(() => {
    if (isPool15OnlyGame(category) || (isPool && gameMode === 'pro')) {
      return PLAYER_NUMBER_POOL_15;
    }

    if (isPool) {
      return PLAYER_NUMBER_POOL;
    }

    return PLAYER_NUMBER;
  }, [category, gameMode, isPool]);

  const pointSteps = useMemo(() => Object.keys(PLAYER_POINT_STEPS), []);

  const showRenamePaywall = useCallback(() => {
    showPaywall('rename_player');
  }, [showPaywall]);

  const openCountryModal = useCallback((index: number) => {
    if (!isAplusProActive) {
      showPaywall('change_flag');
      return;
    }

    setCountryPlayerIndex(index);
    setCountryKeyword('');
    setCountryModalVisible(true);
    requestAnimationFrame(reapplyFullscreenSystemUI);
  }, [isAplusProActive, reapplyFullscreenSystemUI, showPaywall]);

  const closeCountryModal = useCallback(() => {
    setCountryModalVisible(false);
    setCountryKeyword('');
    setCountryPlayerIndex(null);
    requestAnimationFrame(reapplyFullscreenSystemUI);
  }, [reapplyFullscreenSystemUI]);

  useEffect(() => {
    if (!countryModalVisible) {
      return;
    }

    reapplyFullscreenSystemUI();

    const timers = [0, 80, 180].map(delay =>
      setTimeout(reapplyFullscreenSystemUI, delay),
    );

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [countryModalVisible, reapplyFullscreenSystemUI]);

  const filteredCountries = useMemo(() => {
    const keyword = normalizeCountryName(countryKeyword);

    if (!keyword) {
      return COUNTRIES;
    }

    return COUNTRIES.filter(item => {
      return (
        item.normalizedName.includes(keyword) ||
        normalizeCountryName(item.name).includes(keyword) ||
        item.code.toLowerCase().includes(keyword)
      );
    });
  }, [countryKeyword]);

  const renderSelectorRow = useCallback(
    (
      label: string,
      data: Record<string, number>,
      currentItem: number,
      onSelect: (value: any, index?: number) => void,
      extraArgIndex = false,
      compact = false,
    ) => {
      return (
        <View style={[styles.controlRow, compact && styles.controlRowCompact]}>
          <Text style={styles.controlLabel}>{label}</Text>
          <View style={styles.controlOptionsRow}>
            {Object.keys(data).map((key, index) => {
              const item = data[key];
              const active = item === currentItem;
              return (
                <Pressable
                  key={`${label}-${key}`}
                  onPress={() =>
                    extraArgIndex ? onSelect(item, index) : onSelect(item)
                  }
                  style={({pressed}) => [
                    styles.selectorButton,
                    active && styles.selectorButtonActive,
                    pressed && styles.selectorButtonPressed,
                  ]}>
                  <Text
                    style={[
                      styles.selectorButtonText,
                      active && styles.selectorButtonTextActive,
                    ]}>
                    {item}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    },
    [styles],
  );

  const renderGoal = useCallback(() => {
    const goalOptions = [
      ...playerSettings.goal.pointSteps.slice(0, 2),
      playerSettings.goal.goal,
      ...playerSettings.goal.pointSteps.slice(-2),
    ];

    const goalMap = goalOptions.reduce((acc, item, index) => {
      acc[`goal-${index}`] = item;
      return acc;
    }, {} as Record<string, number>);

    return renderSelectorRow(
      isEnglish ? 'Target' : 'Mục tiêu',
      goalMap,
      playerSettings.goal.goal,
      onSelectPlayerGoal,
      true,
      true,
    );
  }, [
    onSelectPlayerGoal,
    playerSettings.goal.goal,
    playerSettings.goal.pointSteps,
    renderSelectorRow,
    translate,
  ]);

  const renderPlayerItem = useCallback(
    (player: Player, index: number) => {
      const currentPlayer = player as Player & {
        flag?: string;
        countryCode?: string;
        countryName?: string;
      };
      const playerName = currentPlayer.name ?? '';
      const playerInitial = playerName.trim().charAt(0) || 'N';
      const playerFlagImage = getPlayerFlagImageUri(currentPlayer);
      const playerFlagText = getPlayerFlagText(currentPlayer);
      const isClassicDarkCard = !isPool && index >= 2;
      const avatarSize = isPool ? adaptive.s(48) : adaptive.s(44);
      const flagWidth = isPool ? adaptive.s(36) : adaptive.s(34);
      const flagHeight = isPool ? adaptive.s(24) : adaptive.s(22);

      const avatarShellStyle = {
        width: avatarSize,
        height: avatarSize,
        minHeight: 0,
        borderRadius: adaptive.s(10),
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        overflow: 'hidden' as const,
        alignSelf: 'center' as const,
        backgroundColor: isClassicDarkCard
          ? 'rgba(255,255,255,0.14)'
          : isPool
          ? '#D8D8D8'
          : '#F4ECD1',
      };

      const flagFrameStyle = {
        width: flagWidth,
        height: flagHeight,
        borderRadius: adaptive.s(4),
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.55)',
        overflow: 'hidden' as const,
      };

      return (
        <View
          key={`player-card-${index}`}
          style={[
            styles.playerCard,
            isPool ? styles.playerCardPool : {backgroundColor: currentPlayer.color},
          ]}>
          <Pressable
            onPress={() => openCountryModal(index)}
            style={({pressed}) => [
              avatarShellStyle,
              pressed && styles.selectorButtonPressed,
            ]}>
            {playerFlagImage ? (
              <View style={flagFrameStyle}>
                <Image
                  source={{uri: playerFlagImage}}
                  resizeMode="cover"
                  fadeDuration={0}
                  style={{width: '100%', height: '100%', backgroundColor: '#FFFFFF'}}
                />
              </View>
            ) : (
              <Text
                style={[
                  styles.avatarText,
                  isClassicDarkCard && !playerFlagText && styles.avatarTextLight,
                ]}>
                {playerFlagText || playerInitial}
              </Text>
            )}
          </Pressable>

          <View style={styles.playerCardRight}>
            <View style={styles.playerCardTop}>
              <EditablePlayerNameInput
                value={playerName}
                index={index}
                isPool={isPool}
                inputStyle={[styles.nameInput, isPool && styles.nameInputPool]}
                onCommit={onChangePlayerName}
                editable={isAplusProActive}
                onBlockedPress={showRenamePaywall}
                placeholder={translate(
                  `player${index + 1}`,
                  `Người chơi ${index + 1}`,
                  `Player ${index + 1}`,
                )}
              />
            </View>

            <View style={[styles.scoreRow, isPool && styles.scoreRowPool]}>
              {pointSteps.map((key, stepIndex) => {
                const value = (PLAYER_POINT_STEPS as any)[key] as number;
                const isCenter = stepIndex === 4;

                return (
                  <Pressable
                    key={`point-step-${index}-${key}`}
                    onPress={() => onChangePlayerPoint(value, index, stepIndex)}
                    disabled={isCenter}
                    style={({pressed}) => [
                      styles.scoreItem,
                      isCenter && styles.scoreItemCenter,
                      isPool && styles.scoreItemPool,
                      isCenter && isPool && styles.scoreItemCenterPool,
                      pressed && !isCenter && styles.selectorButtonPressed,
                    ]}>
                    <Text
                      style={[
                        styles.scoreText,
                        isCenter && styles.scoreTextCenter,
                        isPool && styles.scoreTextPool,
                      ]}>
                      {isCenter ? currentPlayer.totalPoint : value}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      );
    },
    [
      adaptive,
      isAplusProActive,
      isPool,
      onChangePlayerName,
      onChangePlayerPoint,
      openCountryModal,
      pointSteps,
      showRenamePaywall,
      styles,
      translate,
    ],
  );

  return (
    <View style={styles.container}>
      {showTitle ? <Text style={styles.mainTitle}>{title}</Text> : null}

      <View style={styles.topControls}>
        {renderSelectorRow(
          isEnglish ? 'Players' : 'Số người',
          playerNumberOptions,
          playerSettings.playerNumber,
          onSelectPlayerNumber,
          false,
          true,
        )}

        {renderGoal()}
      </View>

      <View style={styles.playerList}>
        {playerSettings.playingPlayers.map(renderPlayerItem)}
      </View>

      <Modal
        visible={countryModalVisible}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        navigationBarTranslucent={true}
        hardwareAccelerated={true}
        onShow={reapplyFullscreenSystemUI}
        onRequestClose={closeCountryModal}>
        <Pressable style={styles.countryModalOverlay} onPress={closeCountryModal}>
          <Pressable style={styles.countryModalCard} onPress={() => {}}>
            <Text style={styles.countryModalTitle}>
              {isEnglish ? 'Select country' : 'Chọn quốc gia'}
            </Text>

            <TextInput
              value={countryKeyword}
              onChangeText={setCountryKeyword}
              placeholder={isEnglish ? 'Search country...' : 'Tìm quốc gia...'}
              placeholderTextColor="#8E8E8E"
              autoCorrect={false}
              autoCapitalize="words"
              autoFocus={false}
              onFocus={reapplyFullscreenSystemUI}
              style={styles.countrySearchInput}
            />

            <FlatList
              data={filteredCountries}
              keyExtractor={item => item.code}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.countryList}
              renderItem={({item}) => {
                const displayFlag = item.flag || item.code || '--';
                const displayFlagImage = getCountryFlagImageUri(item.code, 80);

                return (
                  <Pressable
                    style={({pressed}) => [
                      styles.countryItem,
                      pressed && styles.countryItemPressed,
                    ]}
                    onPress={() => {
                      if (countryPlayerIndex !== null) {
                        onSelectPlayerCountry(
                          {
                            ...item,
                            flag: displayFlag,
                          },
                          countryPlayerIndex,
                        );
                      }
                      closeCountryModal();
                    }}>
                    {displayFlagImage ? (
                      <View
                        style={{
                          width: 42,
                          height: 28,
                          marginRight: 12,
                          borderRadius: 4,
                          backgroundColor: '#FFFFFF',
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.55)',
                          overflow: 'hidden',
                        }}>
                        <Image
                          source={{uri: displayFlagImage}}
                          resizeMode="cover"
                          fadeDuration={0}
                          style={{width: '100%', height: '100%'}}
                        />
                      </View>
                    ) : (
                      <Text style={styles.countryFlag}>{displayFlag}</Text>
                    )}
                    <Text style={styles.countryName}>{item.name}</Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.countryEmptyText}>
                  {isEnglish ? 'No result found' : 'Không tìm thấy kết quả'}
                </Text>
              }
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

export default PlayerSettingsComponent;


