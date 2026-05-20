import React, {memo, useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View} from 'react-native';
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
import type {AplusLiveSettingsPanelState} from '../SettingsViewModel';

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
  aplusLivePanel?: AplusLiveSettingsPanelState;
  onRefreshAplusTournaments?: () => void;
  onSelectAplusTournament?: (tournamentId: string) => void;
  onChangeAplusMatchCode?: (matchCode: string) => void;
  onCheckAplusLiveMatch?: () => void;
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

const normalizeAplusMatchCode = (value: string) => {
  const rawCode = String(value || '').toUpperCase().replace(/[^T0-9]/g, '');

  if (!rawCode) {
    return '';
  }

  const hasLeadingT = rawCode.startsWith('T');
  const digits = rawCode.replace(/T/g, '').replace(/\D/g, '').slice(0, 3);

  if (hasLeadingT && !digits) {
    return 'T';
  }

  return digits ? `T${digits}` : '';
};

const AplusMatchCodeInput = memo(
  ({
    value,
    editable,
    onChange,
    inputStyle,
    disabledStyle,
  }: {
    value: string;
    editable: boolean;
    onChange?: (matchCode: string) => void;
    inputStyle: any[];
    disabledStyle: any;
  }) => {
    const [draftCode, setDraftCode] = useState(normalizeAplusMatchCode(value));

    useEffect(() => {
      const normalizedValue = normalizeAplusMatchCode(value);
      setDraftCode(prev => (prev === normalizedValue ? prev : normalizedValue));
    }, [value]);

    const handleChangeText = useCallback(
      (text: string) => {
        const normalizedValue = normalizeAplusMatchCode(text);
        setDraftCode(normalizedValue);
        onChange?.(normalizedValue);
      },
      [onChange],
    );

    return (
      <TextInput
        value={draftCode}
        editable={editable}
        onChangeText={handleChangeText}
        placeholder="T01"
        placeholderTextColor="#8E8E8E"
        autoCapitalize="characters"
        autoCorrect={false}
        selectTextOnFocus={false}
        style={[inputStyle, !editable && disabledStyle]}
      />
    );
  },
);

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
  aplusLivePanel,
  onRefreshAplusTournaments,
  onSelectAplusTournament,
  onChangeAplusMatchCode,
  onCheckAplusLiveMatch,
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
  const [tournamentModalVisible, setTournamentModalVisible] = useState(false);
  const [tournamentKeyword, setTournamentKeyword] = useState('');

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

  const openTournamentModal = useCallback(() => {
    setTournamentKeyword('');
    setTournamentModalVisible(true);
    requestAnimationFrame(reapplyFullscreenSystemUI);
  }, [reapplyFullscreenSystemUI]);

  const closeTournamentModal = useCallback(() => {
    setTournamentModalVisible(false);
    setTournamentKeyword('');
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

  useEffect(() => {
    if (!tournamentModalVisible) {
      return;
    }

    reapplyFullscreenSystemUI();

    const timers = [0, 80, 180].map(delay =>
      setTimeout(reapplyFullscreenSystemUI, delay),
    );

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [tournamentModalVisible, reapplyFullscreenSystemUI]);

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

  const filteredTournaments = useMemo(() => {
    const tournaments = aplusLivePanel?.tournaments || [];
    const keyword = String(tournamentKeyword || '').trim().toLowerCase();

    if (!keyword) {
      return tournaments;
    }

    return tournaments.filter(item => {
      const name = String(item?.name || '').toLowerCase();
      const slug = String(item?.slug || '').toLowerCase();
      const id = String(item?._id || '').toLowerCase();

      return name.includes(keyword) || slug.includes(keyword) || id.includes(keyword);
    });
  }, [aplusLivePanel?.tournaments, tournamentKeyword]);

  const selectedAplusTournamentId = aplusLivePanel?.selectedTournamentId || '';

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

  const renderAplusLivePanel = useCallback(() => {
    if (gameMode !== 'pro') {
      return null;
    }

    const panel = aplusLivePanel;
    const isTwoPlayer = playerSettings.playerNumber === 2;
    const loading = panel?.connectStatus === 'loading';
    const checking = panel?.connectStatus === 'checking';
    const claiming = panel?.connectStatus === 'claiming';
    const disabled = !isTwoPlayer || loading || checking || claiming;
    const selectedTournamentId = panel?.selectedTournamentId || '';
    const tournaments = panel?.tournaments || [];
    const selectedTournament = tournaments.find(
      item => item._id === selectedTournamentId,
    );
    const matchCode = panel?.matchCodeInput || '';
    const isValidMatchCode = /^T\d{1,3}$/.test(matchCode);
    const canCheck = Boolean(
      isTwoPlayer &&
        isValidMatchCode &&
        Boolean(selectedTournamentId) &&
        !loading &&
        !checking &&
        !claiming,
    );
    const needsTournament = Boolean(isTwoPlayer && isValidMatchCode && !selectedTournamentId);

    return (
      <View style={styles.aplusPanel}>
        <View style={styles.aplusPanelHeaderRow}>
          <View style={styles.aplusPanelTitleBlock}>
            <Text style={styles.aplusPanelTitle}>
              {isEnglish ? 'Aplus web connection' : 'Kết nối web Aplus'}
            </Text>
            <Text style={styles.aplusPanelSubtitle}>
              {isEnglish
                ? 'Only visible in Competition mode.'
                : 'Chỉ hiện ở chế độ Thi đấu.'}
            </Text>
          </View>

          <Pressable
            onPress={onRefreshAplusTournaments}
            disabled={loading}
            style={({pressed}) => [
              styles.aplusSmallButton,
              loading && styles.aplusButtonDisabled,
              pressed && !loading && styles.selectorButtonPressed,
            ]}>
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.aplusSmallButtonText}>
                {isEnglish ? 'Reload' : 'Tải lại'}
              </Text>
            )}
          </Pressable>
        </View>

        {!isTwoPlayer ? (
          <Text style={styles.aplusWarningText}>
            {isEnglish
              ? 'Aplus web connection only supports 2 players.'
              : 'Kết nối web chỉ hỗ trợ 2 người chơi.'}
          </Text>
        ) : null}

        <Text style={styles.aplusFieldLabel}>
          {isEnglish ? 'Tournament' : 'Chọn giải'}
        </Text>

        {tournaments.length ? (
          <Pressable
            disabled={disabled}
            onPress={openTournamentModal}
            style={({pressed}) => [
              styles.aplusTournamentSelector,
              disabled && styles.aplusButtonDisabled,
              pressed && !disabled && styles.selectorButtonPressed,
            ]}>
            <View style={styles.aplusTournamentSelectorContent}>
              <Text
                numberOfLines={1}
                style={[
                  styles.aplusTournamentSelectorText,
                  !selectedTournament && styles.aplusTournamentPlaceholder,
                ]}>
                {selectedTournament
                  ? selectedTournament.name || selectedTournament.slug || selectedTournament._id
                  : isEnglish
                  ? 'Select tournament'
                  : 'Chọn giải'}
              </Text>

              <Text style={styles.aplusTournamentChevron}>▼</Text>
            </View>
          </Pressable>
        ) : (
          <Text style={styles.aplusEmptyText}>
            {loading
              ? isEnglish
                ? 'Loading tournaments...'
                : 'Đang tải danh sách giải...'
              : isEnglish
              ? 'No tournament loaded.'
              : 'Chưa tải được giải nào.'}
          </Text>
        )}

        <View style={styles.aplusInputRow}>
          <View style={styles.aplusInputGroup}>
            <Text style={styles.aplusFieldLabel}>
              {isEnglish ? 'Match code' : 'Mã trận'}
            </Text>
            <AplusMatchCodeInput
              value={matchCode}
              editable={!disabled}
              onChange={onChangeAplusMatchCode}
              inputStyle={[styles.aplusInput]}
              disabledStyle={styles.aplusInputDisabled}
            />
          </View>

          <Pressable
            onPress={onCheckAplusLiveMatch}
            disabled={!canCheck}
            style={({pressed}) => [
              styles.aplusPrimaryButton,
              !canCheck && styles.aplusButtonDisabled,
              pressed && canCheck && styles.selectorButtonPressed,
            ]}>
            {checking || claiming ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.aplusPrimaryButtonText}>
                {isEnglish ? 'Check' : 'Kiểm tra'}
              </Text>
            )}
          </Pressable>
        </View>

        {selectedTournament ? (
          <Text style={styles.aplusHintText} numberOfLines={1}>
            {isEnglish ? 'Selected: ' : 'Đang chọn: '}
            {selectedTournament.name || selectedTournament.slug}
          </Text>
        ) : null}

        {needsTournament ? (
          <Text style={styles.aplusWarningText}>
            {isEnglish
              ? 'The match code is valid. Reload and select a tournament before checking.'
              : 'Mã trận đã hợp lệ. Hãy bấm Tải lại và chọn giải trước khi kiểm tra.'}
          </Text>
        ) : null}

        {isTwoPlayer && matchCode.length > 0 && !isValidMatchCode ? (
          <Text style={styles.aplusHintText}>
            {isEnglish
              ? 'Enter T + number, for example T01 or T12.'
              : 'Nhập mã dạng T + số, ví dụ T01 hoặc T12.'}
          </Text>
        ) : null}

        {panel?.connectError ? (
          <Text style={styles.aplusErrorText}>{panel.connectError}</Text>
        ) : null}

        {panel?.connectMessage ? (
          <Text style={styles.aplusSuccessText}>{panel.connectMessage}</Text>
        ) : null}

        {panel?.previewMatch ? (
          <View style={styles.aplusMatchPreview}>
            <Text style={styles.aplusMatchPreviewCode}>
              {panel.previewMatch.matchCode || matchCode}
            </Text>
            <Text style={styles.aplusMatchPreviewText} numberOfLines={2}>
              {panel.previewMatch.player1}  vs  {panel.previewMatch.player2}
            </Text>
            <Text style={styles.aplusMatchPreviewMeta}>
              {panel.previewMatch.roundName || ''}
              {panel.previewMatch.tableNumber ? ` • ${panel.previewMatch.tableNumber}` : ''}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }, [
    aplusLivePanel,
    gameMode,
    isEnglish,
    onChangeAplusMatchCode,
    onCheckAplusLiveMatch,
    onRefreshAplusTournaments,
    onSelectAplusTournament,
    openTournamentModal,
    playerSettings.playerNumber,
    styles,
  ]);

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

      {renderAplusLivePanel()}

      <Modal
        visible={tournamentModalVisible}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        navigationBarTranslucent={true}
        hardwareAccelerated={true}
        onShow={reapplyFullscreenSystemUI}
        onRequestClose={closeTournamentModal}>
        <Pressable
          style={styles.countryModalOverlay}
          onPress={closeTournamentModal}>
          <Pressable style={styles.tournamentModalCard} onPress={() => {}}>
            <Text style={styles.countryModalTitle}>
              {isEnglish ? 'Select tournament' : 'Chọn giải'}
            </Text>

            <TextInput
              value={tournamentKeyword}
              onChangeText={setTournamentKeyword}
              placeholder={isEnglish ? 'Search tournament...' : 'Tìm giải...'}
              placeholderTextColor="#8E8E8E"
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus={false}
              onFocus={reapplyFullscreenSystemUI}
              style={styles.countrySearchInput}
            />

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.countryList}>
              {filteredTournaments.length ? (
                filteredTournaments.map(item => {
                  const active = item._id === selectedAplusTournamentId;

                  return (
                    <Pressable
                      key={item._id}
                      style={({pressed}) => [
                        styles.tournamentItem,
                        active && styles.tournamentItemActive,
                        pressed && styles.countryItemPressed,
                      ]}
                      onPress={() => {
                        onSelectAplusTournament?.(item._id);
                        closeTournamentModal();
                      }}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.tournamentItemText,
                          active && styles.tournamentItemTextActive,
                        ]}>
                        {item.name || item.slug || item._id}
                      </Text>
                    </Pressable>
                  );
                })
              ) : (
                <Text style={styles.countryEmptyText}>
                  {isEnglish ? 'No tournament found' : 'Không tìm thấy giải'}
                </Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

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

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.countryList}>
              {filteredCountries.length ? (
                filteredCountries.map(item => {
                  const displayFlag = item.flag || item.code || '--';
                  const displayFlagImage = getCountryFlagImageUri(item.code, 80);

                  return (
                    <Pressable
                      key={item.code}
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
                })
              ) : (
                <Text style={styles.countryEmptyText}>
                  {isEnglish ? 'No result found' : 'Không tìm thấy kết quả'}
                </Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

export default PlayerSettingsComponent;


