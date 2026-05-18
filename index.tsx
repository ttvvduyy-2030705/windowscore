import React, {memo, useMemo} from 'react';
import {
  Image,
  StyleSheet,
  TextInput,
  Text as RNText,
  useWindowDimensions,
} from 'react-native';

import View from 'components/View';
import Button from 'components/Button';
import i18n from 'i18n';
import {isPool15FreeGame, isPool15Game, isPoolGame} from 'utils/game';

import PlayerViewModel, {Props} from './PlayerViewModel';

const isEnglish = () => {
  const locale = String(
    (i18n as any)?.locale || (i18n as any)?.language || '',
  ).toLowerCase();
  return locale.startsWith('en');
};

const tr = (vi: string, en: string) => (isEnglish() ? en : vi);

const isRemoteUri = (value: string) =>
  /^https?:\/\//i.test(value) || /^file:\/\//i.test(value);

const GamePlayer = (
  props: Props & {layout?: 'default' | 'poolArena'; compact?: boolean},
) => {
  const viewModel = PlayerViewModel(props);
  const isPoolMode = isPoolGame(props.gameSettings?.category);
  const isPool15Mode = isPool15Game(props.gameSettings?.category);
  const isPool15FreeMode = isPool15FreeGame(props.gameSettings?.category);
  const isActiveCard = !!props.isOnTurn;

  const {width, height, fontScale} = useWindowDimensions();
  const shortestSide = Math.min(width, height);
  const longestSide = Math.max(width, height);
  const isLandscape = width > height;
  const isLargeDisplay = longestSide >= 1600 || shortestSide >= 900;
  const isMediumLandscape =
    isLandscape && !isLargeDisplay && shortestSide >= 650 && shortestSide < 900;
  const isCompactLandscape =
    isLandscape && !isLargeDisplay && shortestSide < 650;
  const useForcedCompact = isCompactLandscape || shortestSide < 430;

  const isCompactLayout = Boolean(
    props.compact || useForcedCompact || (props.totalPlayers || 2) > 2,
  );
  const isMediumResponsiveLayout =
    !isCompactLayout && isMediumLandscape && (props.totalPlayers || 2) <= 2;

  const isPhoneLandscapeTwoPlayer =
    isLandscape &&
    !isLargeDisplay &&
    (props.totalPlayers || 2) <= 2 &&
    shortestSide < 650;

  const isExtraCompactLayout =
    (props.totalPlayers || 2) >= 4 || (!isLargeDisplay && shortestSide <= 430);

  const uiScale = useMemo(() => {
    if (isLargeDisplay) {
      return 1;
    }

    const base = Math.max(0.72, Math.min(1, shortestSide / 900));
    return Math.max(0.7, Math.min(1, base / Math.min(fontScale || 1, 1.15)));
  }, [fontScale, isLargeDisplay, shortestSide]);

  const isCaromMode = !isPoolMode;
  const isLibreMode = props.gameSettings?.category === 'libre';
  const totalPointValue = Number(props.player.totalPoint || 0);
  const rawPlayerColor = String((props.player as any)?.color || '').trim();
  const useColoredPanel = Boolean(rawPlayerColor) && isCaromMode;
  const playerPanelColor = useColoredPanel ? rawPlayerColor : '#000000';
  const primaryTextColor = useColoredPanel ? '#111111' : '#FFFFFF';
  const secondaryTextColor = useColoredPanel
    ? 'rgba(17,17,17,0.72)'
    : '#FFFFFF';
  const inactiveTextColor = useColoredPanel
    ? 'rgba(17,17,17,0.52)'
    : '#8B8D95';

  const panelDynamicStyle = useColoredPanel
    ? {backgroundColor: playerPanelColor, borderColor: 'rgba(17,17,17,0.28)'}
    : {backgroundColor: '#000000', borderColor: '#FF1818'};

  const textColorStyle = {color: primaryTextColor};
  const inactivePlaceholderColor = inactiveTextColor;

  const scoreLayerDynamicStyle = isCaromMode
    ? isPhoneLandscapeTwoPlayer
      ? styles.scoreLayerCaromPhoneLandscape
      : isExtraCompactLayout
      ? styles.scoreLayerCaromExtraCompact
      : isCompactLayout
      ? styles.scoreLayerCaromCompact
      : styles.scoreLayerCarom
    : isPhoneLandscapeTwoPlayer
    ? styles.scoreLayerPhoneLandscape
    : isExtraCompactLayout
    ? styles.scoreLayerExtraCompact
    : isCompactLayout
    ? styles.scoreLayerCompact
    : undefined;

  const scoreTextDynamicStyle = isCaromMode
    ? isPhoneLandscapeTwoPlayer
      ? styles.scoreTextCaromPhoneLandscape
      : isExtraCompactLayout
      ? styles.scoreTextCaromExtraCompact
      : isCompactLayout
      ? styles.scoreTextCaromCompact
      : styles.scoreTextCarom
    : isPhoneLandscapeTwoPlayer
    ? styles.scoreTextPhoneLandscape
    : isExtraCompactLayout
    ? styles.scoreTextExtraCompact
    : isCompactLayout
    ? styles.scoreTextCompact
    : undefined;

  const libreScoreTextStyle = useMemo(() => {
    if (!isLibreMode || totalPointValue < 100) {
      return undefined;
    }

    if (isPhoneLandscapeTwoPlayer) {
      return totalPointValue >= 1000
        ? styles.scoreTextLibre4DigitsPhoneLandscape
        : styles.scoreTextLibre3DigitsPhoneLandscape;
    }

    if (isExtraCompactLayout) {
      return totalPointValue >= 1000
        ? styles.scoreTextLibre4DigitsExtraCompact
        : styles.scoreTextLibre3DigitsExtraCompact;
    }

    if (isCompactLayout) {
      return totalPointValue >= 1000
        ? styles.scoreTextLibre4DigitsCompact
        : styles.scoreTextLibre3DigitsCompact;
    }

    return totalPointValue >= 1000
      ? styles.scoreTextLibre4Digits
      : styles.scoreTextLibre3Digits;
  }, [
    isLibreMode,
    totalPointValue,
    isPhoneLandscapeTwoPlayer,
    isExtraCompactLayout,
    isCompactLayout,
  ]);

  const extraTimeTurns = Math.max(
    0,
    Number((props.player as any)?.proMode?.extraTimeTurns ?? 0),
  );

  const showAddTime = extraTimeTurns > 0 && !isPool15Mode;

  const scoreTextOpticalCenterStyle = useMemo(() => {
    const digits = String(Math.abs(totalPointValue)).length;

    if (digits <= 1) {
      if (isPhoneLandscapeTwoPlayer) {
        return styles.scoreTextSingleDigitPhoneLandscape;
      }
      if (isExtraCompactLayout) {
        return styles.scoreTextSingleDigitExtraCompact;
      }
      if (isCompactLayout) {
        return styles.scoreTextSingleDigitCompact;
      }
      if (isMediumResponsiveLayout) {
        return styles.scoreTextSingleDigitMedium;
      }
      return styles.scoreTextSingleDigit;
    }

    if (digits === 2) {
      if (isPhoneLandscapeTwoPlayer) {
        return styles.scoreTextDoubleDigitPhoneLandscape;
      }
      if (isExtraCompactLayout) {
        return styles.scoreTextDoubleDigitExtraCompact;
      }
      if (isCompactLayout) {
        return styles.scoreTextDoubleDigitCompact;
      }
      if (isMediumResponsiveLayout) {
        return styles.scoreTextDoubleDigitMedium;
      }
      return styles.scoreTextDoubleDigit;
    }

    return undefined;
  }, [
    totalPointValue,
    isPhoneLandscapeTwoPlayer,
    isExtraCompactLayout,
    isCompactLayout,
    isMediumResponsiveLayout,
  ]);

  const addTimeButtons = useMemo(() => {
    return Array.from({length: extraTimeTurns}, (_, index) => index);
  }, [extraTimeTurns]);

  const rawFlag = String((props.player as any)?.flag || '').trim();
  const playerFlagUri = isRemoteUri(rawFlag) ? rawFlag : '';
  const playerFlagText = playerFlagUri ? '' : rawFlag;

  return (
    <View
      style={[
        styles.panel,
        !isLargeDisplay && styles.panelScaled,
        isMediumResponsiveLayout ? styles.panelMedium : undefined,
        isPhoneLandscapeTwoPlayer ? styles.panelPhoneLandscape : undefined,
        panelDynamicStyle,
        isActiveCard ? styles.panelActive : styles.panelInactive,
      ]}>
      <View
        style={[
          styles.nameRow,
          isMediumResponsiveLayout ? styles.nameRowMedium : undefined,
          isCompactLayout && styles.nameRowCompact,
        ]}>
        {playerFlagUri ? (
          <View
            style={[
              styles.flagBadge,
              isMediumResponsiveLayout ? styles.flagBadgeMedium : undefined,
              isCompactLayout && styles.flagBadgeCompact,
              isActiveCard ? styles.flagBadgeActive : styles.flagBadgeInactive,
            ]}>
            <Image
              source={{uri: playerFlagUri}}
              style={styles.flagImage}
              resizeMode="contain"
            />
          </View>
        ) : playerFlagText ? (
          <View
            style={[
              styles.flagBadge,
              isMediumResponsiveLayout ? styles.flagBadgeMedium : undefined,
              isCompactLayout && styles.flagBadgeCompact,
              isActiveCard ? styles.flagBadgeActive : styles.flagBadgeInactive,
            ]}>
            <RNText
              style={[
                styles.flagText,
                isMediumResponsiveLayout ? styles.flagTextMedium : undefined,
                isCompactLayout && styles.flagTextCompact,
                !isActiveCard && styles.flagTextInactive,
              ]}>
              {playerFlagText}
            </RNText>
          </View>
        ) : null}

        {viewModel.nameEditable ? (
          <TextInput
            value={viewModel.draftName}
            onChangeText={viewModel.onChangeDraftName}
            autoFocus
            onBlur={viewModel.onCommitName}
            onSubmitEditing={viewModel.onCommitName}
            blurOnSubmit
            numberOfLines={1}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}
            style={[
              styles.nameInput,
              {fontSize: Math.round(42 * uiScale), lineHeight: Math.round(48 * uiScale)},
              (playerFlagUri || playerFlagText) && styles.nameTextWithFlag,
              isMediumResponsiveLayout ? styles.nameInputMedium : undefined,
              isCompactLayout && styles.nameInputCompact,
              textColorStyle,
              !isActiveCard && styles.nameTextInactive,
            ]}
            placeholderTextColor={inactivePlaceholderColor}
          />
        ) : (
          <RNText
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}
            style={[
              styles.nameText,
              {fontSize: Math.round(42 * uiScale), lineHeight: Math.round(48 * uiScale)},
              (playerFlagUri || playerFlagText) && styles.nameTextWithFlag,
              isMediumResponsiveLayout ? styles.nameTextMedium : undefined,
              isCompactLayout && styles.nameTextCompact,
              textColorStyle,
              !isActiveCard && styles.nameTextInactive,
            ]}>
            {props.player.name}
          </RNText>
        )}

        <Button
          onPress={viewModel.onToggleEditName}
          style={[
            styles.editButton,
            isMediumResponsiveLayout ? styles.editButtonMedium : undefined,
            isCompactLayout && styles.editButtonCompact,
            !isActiveCard && styles.editButtonInactive,
          ]}>
          <RNText
            style={[
              styles.editText,
              isMediumResponsiveLayout ? styles.editTextMedium : undefined,
              isCompactLayout && styles.editTextCompact,
              textColorStyle,
              !isActiveCard && styles.editTextInactive,
            ]}>
            ✎
          </RNText>
        </Button>
      </View>

      <View
        direction={'row'}
        style={[
          styles.plusMinusRow,
          isMediumResponsiveLayout ? styles.plusMinusRowMedium : undefined,
          isCompactLayout && styles.plusMinusRowCompact,
          !isActiveCard && styles.controlsRowInactive,
        ]}>
        <Button
          style={[
            styles.stepButton,
            isMediumResponsiveLayout ? styles.stepButtonMedium : undefined,
            isCompactLayout && styles.stepButtonCompact,
          ]}
          onPress={viewModel.onDecreasePoint}>
          <RNText
            style={[
              styles.stepButtonText,
              {fontSize: Math.round((isCompactLayout ? 26 : 30) * uiScale)},
              isMediumResponsiveLayout ? styles.stepButtonTextMedium : undefined,
              isCompactLayout && styles.stepButtonTextCompact,
            ]}>
            −
          </RNText>
        </Button>

        <Button
          style={[
            styles.stepButton,
            isMediumResponsiveLayout ? styles.stepButtonMedium : undefined,
            isCompactLayout && styles.stepButtonCompact,
          ]}
          onPress={viewModel.onIncreasePoint}>
          <RNText
            style={[
              styles.stepButtonText,
              {fontSize: Math.round((isCompactLayout ? 26 : 30) * uiScale)},
              isMediumResponsiveLayout ? styles.stepButtonTextMedium : undefined,
              isCompactLayout && styles.stepButtonTextCompact,
            ]}>
            ＋
          </RNText>
        </Button>
      </View>

      {viewModel.showProMode ? (
        <View
          direction={'row'}
          style={[
            styles.statsRow,
            isMediumResponsiveLayout ? styles.statsRowMedium : undefined,
            isCompactLayout && styles.statsRowCompact,
            !isActiveCard && styles.statsRowInactive,
          ]}>
          <View style={styles.statBlock}>
            <RNText
              style={[
                styles.statLabel,
                isMediumResponsiveLayout ? styles.statLabelMedium : undefined,
                isCompactLayout && styles.statLabelCompact,
                {color: secondaryTextColor},
              ]}
              allowFontScaling={false}
              maxFontSizeMultiplier={1}>
              High run 1
            </RNText>
            <RNText
              style={[
                styles.statValue,
                isMediumResponsiveLayout ? styles.statValueMedium : undefined,
                isCompactLayout && styles.statValueCompact,
                textColorStyle,
              ]}
              allowFontScaling={false}
              maxFontSizeMultiplier={1}>
              {viewModel.highestRate}
            </RNText>
          </View>

          <View style={styles.statBlock}>
            <RNText
              style={[
                styles.statLabel,
                isMediumResponsiveLayout ? styles.statLabelMedium : undefined,
                isCompactLayout && styles.statLabelCompact,
                {color: secondaryTextColor},
              ]}
              allowFontScaling={false}
              maxFontSizeMultiplier={1}>
              High run 2
            </RNText>
            <RNText
              style={[
                styles.statValue,
                isMediumResponsiveLayout ? styles.statValueMedium : undefined,
                isCompactLayout && styles.statValueCompact,
                textColorStyle,
              ]}
              allowFontScaling={false}
              maxFontSizeMultiplier={1}>
              {viewModel.secondHighestRate}
            </RNText>
          </View>

          <View style={styles.statBlock}>
            <RNText
              style={[
                styles.statLabel,
                isMediumResponsiveLayout ? styles.statLabelMedium : undefined,
                isCompactLayout && styles.statLabelCompact,
                {color: secondaryTextColor},
              ]}
              allowFontScaling={false}
              maxFontSizeMultiplier={1}>
              Average
            </RNText>
            <RNText
              style={[
                styles.statValue,
                isMediumResponsiveLayout ? styles.statValueMedium : undefined,
                isCompactLayout && styles.statValueCompact,
                textColorStyle,
              ]}
              allowFontScaling={false}
              maxFontSizeMultiplier={1}>
              {viewModel.averagePoint}
            </RNText>
          </View>
        </View>
      ) : null}

      <View
        style={[
          styles.scoreLayer,
          isMediumResponsiveLayout ? styles.scoreLayerMedium : undefined,
          scoreLayerDynamicStyle,
          !isActiveCard && styles.scoreLayerInactive,
          isPool15FreeMode && styles.scoreLayerWithScoredBalls,
        ]}
        pointerEvents="none">
        <View
          style={[
            styles.scoreTextWrap,
            isMediumResponsiveLayout ? styles.scoreTextWrapMedium : undefined,
            isCompactLayout && styles.scoreTextWrapCompact,
          ]}>
          <RNText
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            style={[
              styles.scoreText,
              isMediumResponsiveLayout ? styles.scoreTextMedium : undefined,
              scoreTextDynamicStyle,
              libreScoreTextStyle,
              scoreTextOpticalCenterStyle,
              textColorStyle,
            ]}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}>
            {totalPointValue}
          </RNText>
        </View>
      </View>

      {showAddTime ? (
        <View
          style={[
            styles.addTimeStack,
            isMediumResponsiveLayout ? styles.addTimeStackMedium : undefined,
            isCompactLayout && styles.addTimeStackCompact,
            !isActiveCard && styles.addTimeStackInactive,
          ]}>
          {addTimeButtons.map(index => (
            <Button
              key={`extra-time-${index}`}
              onPress={isActiveCard ? props.onPressGiveMoreTime : undefined}
              style={[
                styles.addTimeButton,
                isMediumResponsiveLayout ? styles.addTimeButtonMedium : undefined,
                isCompactLayout && styles.addTimeButtonCompact,
                !isActiveCard && styles.addTimeButtonInactive,
              ]}>
              <RNText
                style={[
                  styles.addTimeText,
                  isMediumResponsiveLayout ? styles.addTimeTextMedium : undefined,
                  isCompactLayout && styles.addTimeTextCompact,
                  !isActiveCard && styles.addTimeTextInactive,
                ]}
                allowFontScaling={false}
                maxFontSizeMultiplier={1}>
                ◷+
              </RNText>
            </Button>
          ))}
        </View>
      ) : null}

      {isPool15FreeMode && (props.player.scoredBalls || []).length > 0 ? (
        <View
          style={[
            styles.scoredBallStack,
            isMediumResponsiveLayout ? styles.scoredBallStackMedium : undefined,
            isCompactLayout && styles.scoredBallStackCompact,
            !isActiveCard && styles.scoredBallStackInactive,
          ]}>
          {(props.player.scoredBalls || []).map((ball, index) => {
            const isBlackBall = ball.number === 8;
            const textColor = isBlackBall ? '#FFFFFF' : '#111111';

            return (
              <View
                key={`player-scored-ball-${ball.number}-${index}`}
                style={[
                  styles.scoredBallItem,
                  {
                    backgroundColor: ball.cut ? '#FFFFFF' : ball.color,
                    borderColor: ball.color,
                  },
                ]}>
                {ball.cut ? (
                  <View
                    style={[
                      styles.scoredBallStripe,
                      {backgroundColor: ball.color},
                    ]}
                  />
                ) : null}
                <RNText
                  style={[
                    styles.scoredBallText,
                    {color: ball.cut ? '#111111' : textColor},
                  ]}
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}>
                  {ball.number}
                </RNText>
              </View>
            );
          })}
        </View>
      ) : null}

      {isActiveCard ? (
        <Button
          onPress={() => viewModel.onEndTurn()}
          style={[
            styles.playingBadge,
            isMediumResponsiveLayout ? styles.playingBadgeMedium : undefined,
            isCompactLayout && styles.playingBadgeCompact,
            styles.playingBadgeActive,
          ]}>
          <RNText
            style={[
              styles.playingText,
              isMediumResponsiveLayout ? styles.playingTextMedium : undefined,
              isCompactLayout && styles.playingTextCompact,
              styles.playingTextActive,
            ]}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}>
            {tr('Đang đánh', 'Playing')}
          </RNText>
        </Button>
      ) : (
        <View
          style={[
            styles.playingBadge,
            isMediumResponsiveLayout ? styles.playingBadgeMedium : undefined,
            isCompactLayout && styles.playingBadgeCompact,
            styles.playingBadgeInactive,
          ]}>
          <RNText
            style={[
              styles.playingText,
              isMediumResponsiveLayout ? styles.playingTextMedium : undefined,
              isCompactLayout && styles.playingTextCompact,
              styles.playingTextInactive,
            ]}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}>
            {tr('Đang đánh', 'Playing')}
          </RNText>
        </View>
      )}

      <View
        direction={'row'}
        alignItems={'center'}
        style={[
          styles.violateWrap,
          isMediumResponsiveLayout ? styles.violateWrapMedium : undefined,
          isCompactLayout && styles.violateWrapCompact,
          !isActiveCard && styles.violateWrapInactive,
        ]}>
        <View
          style={[
            styles.violateCircle,
            isMediumResponsiveLayout ? styles.violateCircleMedium : undefined,
            isCompactLayout && styles.violateCircleCompact,
            !isActiveCard && styles.violateCircleInactive,
          ]}>
          <RNText
            style={[
              styles.violateX,
              isMediumResponsiveLayout ? styles.violateXMedium : undefined,
              isCompactLayout && styles.violateXCompact,
              !isActiveCard && styles.violateXInactive,
            ]}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}>
            ×
          </RNText>
        </View>
        <RNText
          style={[
            styles.violateCount,
            isMediumResponsiveLayout ? styles.violateCountMedium : undefined,
            isCompactLayout && styles.violateCountCompact,
            textColorStyle,
            !isActiveCard && styles.violateCountInactive,
          ]}
          allowFontScaling={false}
          maxFontSizeMultiplier={1}>
          {props.player.violate || 0}
        </RNText>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    borderRadius: 26,
    borderWidth: 1.4,
    borderColor: '#FF1818',
    backgroundColor: '#000000',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    overflow: 'hidden',
  },
  panelScaled: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: 20,
  },
  panelActive: {
    opacity: 1,
  },
  panelInactive: {
    opacity: 0.52,
  },
  panelPhoneLandscape: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: 18,
  },
  panelMedium: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    borderRadius: 22,
  },
  nameRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameRowMedium: {
    minHeight: 54,
  },
  nameRowCompact: {
    minHeight: 46,
  },
  flagBadge: {
    width: 112,
    height: 76,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    paddingHorizontal: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.4,
    borderColor: 'rgba(255,255,255,0.92)',
    overflow: 'hidden',
  },
  flagBadgeMedium: {
    width: 92,
    height: 62,
    marginRight: 12,
  },
  flagBadgeCompact: {
    width: 76,
    height: 50,
    marginRight: 10,
  },
  flagBadgeActive: {
    opacity: 1,
  },
  flagBadgeInactive: {
    opacity: 0.78,
  },
  flagImage: {
    width: '100%',
    height: '100%',
  },
  flagText: {
    width: '100%',
    fontSize: 52,
    lineHeight: 56,
    textAlign: 'center',
    includeFontPadding: false,
  },
  flagTextMedium: {
    fontSize: 42,
    lineHeight: 44,
  },
  flagTextCompact: {
    fontSize: 34,
    lineHeight: 36,
  },
  flagTextInactive: {
    opacity: 0.92,
  },
  nameText: {
    flex: 1,
    color: '#FFFFFF',
    fontWeight: '900',
    textAlign: 'center',
  },
  nameTextWithFlag: {
    textAlign: 'left',
  },
  nameTextMedium: {},
  nameTextCompact: {},
  nameInput: {
    flex: 1,
    color: '#FFFFFF',
    fontWeight: '900',
    textAlign: 'center',
    paddingVertical: 0,
  },
  nameInputMedium: {},
  nameInputCompact: {},
  nameTextInactive: {
    opacity: 0.9,
  },
  editButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  editButtonMedium: {
    width: 32,
    height: 32,
  },
  editButtonCompact: {
    width: 28,
    height: 28,
  },
  editButtonInactive: {
    opacity: 0.55,
  },
  editText: {
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
  editTextMedium: {
    fontSize: 18,
    lineHeight: 18,
  },
  editTextCompact: {
    fontSize: 16,
    lineHeight: 16,
  },
  editTextInactive: {
    opacity: 0.9,
  },
  plusMinusRow: {
    marginTop: 18,
    justifyContent: 'space-between',
    gap: 14,
  },
  plusMinusRowMedium: {
    marginTop: 12,
    gap: 10,
  },
  plusMinusRowCompact: {
    marginTop: 8,
    gap: 8,
  },
  controlsRowInactive: {
    opacity: 0.7,
  },
  stepButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonMedium: {
    minHeight: 40,
  },
  stepButtonCompact: {
    minHeight: 36,
  },
  stepButtonText: {
    color: '#000000',
    fontWeight: '700',
    includeFontPadding: false,
  },
  stepButtonTextMedium: {},
  stepButtonTextCompact: {},
  statsRow: {
    marginTop: 16,
    justifyContent: 'space-between',
    gap: 12,
  },
  statsRowMedium: {
    marginTop: 10,
    gap: 10,
  },
  statsRowCompact: {
    marginTop: 8,
    gap: 8,
  },
  statsRowInactive: {
    opacity: 0.7,
  },
  statBlock: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '500',
  },
  statLabelMedium: {
    fontSize: 14,
    lineHeight: 16,
  },
  statLabelCompact: {
    fontSize: 12,
    lineHeight: 14,
  },
  statValue: {
    marginTop: 6,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '700',
  },
  statValueMedium: {
    marginTop: 5,
    fontSize: 18,
    lineHeight: 20,
  },
  statValueCompact: {
    marginTop: 4,
    fontSize: 16,
    lineHeight: 18,
  },
  scoreLayer: {
    flex: 1.12,
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 0,
  },
  scoreLayerMedium: {
    paddingVertical: 4,
  },
  scoreLayerCompact: {
    paddingVertical: 2,
  },
  scoreLayerExtraCompact: {
    paddingVertical: 2,
  },
  scoreLayerPhoneLandscape: {
    paddingVertical: 0,
  },
  scoreLayerCarom: {
    paddingVertical: 4,
  },
  scoreLayerCaromCompact: {
    paddingVertical: 2,
  },
  scoreLayerCaromExtraCompact: {
    paddingVertical: 0,
  },
  scoreLayerCaromPhoneLandscape: {
    paddingVertical: 0,
  },
  scoreLayerInactive: {
    opacity: 0.88,
  },
  scoreLayerWithScoredBalls: {
    paddingRight: 44,
  },
  scoreTextWrap: {
    width: '100%',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  scoreTextWrapMedium: {
    paddingHorizontal: 10,
  },
  scoreTextWrapCompact: {
    paddingHorizontal: 8,
  },
  scoreText: {
    width: '100%',
    alignSelf: 'center',
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 230,
    lineHeight: 230,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  scoreTextMedium: {
    fontSize: 198,
    lineHeight: 198,
  },
  scoreTextCompact: {
    fontSize: 165,
    lineHeight: 165,
  },
  scoreTextExtraCompact: {
    fontSize: 135,
    lineHeight: 135,
  },
  scoreTextPhoneLandscape: {
    fontSize: 150,
    lineHeight: 150,
  },
  scoreTextCarom: {
    fontSize: 230,
    lineHeight: 230,
  },
  scoreTextCaromCompact: {
    fontSize: 170,
    lineHeight: 170,
  },
  scoreTextCaromExtraCompact: {
    fontSize: 140,
    lineHeight: 140,
  },
  scoreTextCaromPhoneLandscape: {
    fontSize: 150,
    lineHeight: 150,
  },
  scoreTextLibre3Digits: {
    fontSize: 190,
    lineHeight: 190,
  },
  scoreTextLibre4Digits: {
    fontSize: 150,
    lineHeight: 150,
  },
  scoreTextLibre3DigitsCompact: {
    fontSize: 150,
    lineHeight: 150,
  },
  scoreTextLibre4DigitsCompact: {
    fontSize: 120,
    lineHeight: 120,
  },
  scoreTextLibre3DigitsExtraCompact: {
    fontSize: 128,
    lineHeight: 128,
  },
  scoreTextLibre4DigitsExtraCompact: {
    fontSize: 104,
    lineHeight: 104,
  },
  scoreTextLibre3DigitsPhoneLandscape: {
    fontSize: 132,
    lineHeight: 132,
  },
  scoreTextLibre4DigitsPhoneLandscape: {
    fontSize: 106,
    lineHeight: 106,
  },
  scoreTextSingleDigit: {
    transform: [{translateX: 18}],
  },
  scoreTextSingleDigitMedium: {
    transform: [{translateX: 14}],
  },
  scoreTextSingleDigitCompact: {
    transform: [{translateX: 10}],
  },
  scoreTextSingleDigitExtraCompact: {
    transform: [{translateX: 8}],
  },
  scoreTextSingleDigitPhoneLandscape: {
    transform: [{translateX: 10}],
  },
  scoreTextDoubleDigit: {
    transform: [{translateX: 8}],
  },
  scoreTextDoubleDigitMedium: {
    transform: [{translateX: 6}],
  },
  scoreTextDoubleDigitCompact: {
    transform: [{translateX: 4}],
  },
  scoreTextDoubleDigitExtraCompact: {
    transform: [{translateX: 3}],
  },
  scoreTextDoubleDigitPhoneLandscape: {
    transform: [{translateX: 4}],
  },
  addTimeStack: {
    position: 'absolute',
    right: 12,
    top: '38%',
    gap: 8,
  },
  addTimeStackMedium: {
    right: 10,
    gap: 7,
  },
  addTimeStackCompact: {
    right: 8,
    gap: 6,
  },
  addTimeStackInactive: {
    opacity: 0.7,
  },
  addTimeButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTimeButtonMedium: {
    width: 38,
    height: 38,
  },
  addTimeButtonCompact: {
    width: 34,
    height: 34,
  },
  addTimeButtonInactive: {
    opacity: 0.65,
  },
  addTimeText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  addTimeTextMedium: {
    fontSize: 14,
  },
  addTimeTextCompact: {
    fontSize: 12,
  },
  addTimeTextInactive: {
    opacity: 0.92,
  },
  scoredBallStack: {
    position: 'absolute',
    right: 10,
    top: 120,
    gap: 6,
    alignItems: 'center',
  },
  scoredBallStackMedium: {
    top: 104,
    gap: 5,
  },
  scoredBallStackCompact: {
    top: 92,
    gap: 4,
  },
  scoredBallStackInactive: {
    opacity: 0.8,
  },
  scoredBallItem: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scoredBallStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
    height: '38%',
    marginTop: '31%',
  },
  scoredBallText: {
    fontSize: 11,
    lineHeight: 12,
    fontWeight: '900',
    includeFontPadding: false,
  },
  playingBadge: {
    marginTop: 8,
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C1C20',
  },
  playingBadgeMedium: {
    minHeight: 40,
    marginTop: 8,
    borderRadius: 14,
  },
  playingBadgeCompact: {
    minHeight: 34,
    marginTop: 6,
    borderRadius: 12,
  },
  playingBadgeActive: {
    backgroundColor: '#1A1416',
  },
  playingBadgeInactive: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  playingText: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '900',
  },
  playingTextMedium: {
    fontSize: 18,
    lineHeight: 20,
  },
  playingTextCompact: {
    fontSize: 14,
    lineHeight: 16,
  },
  playingTextActive: {
    color: '#FF3844',
  },
  playingTextInactive: {
    color: '#FFFFFF',
    opacity: 0.45,
  },
  violateWrap: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    gap: 6,
  },
  violateWrapMedium: {
    right: 9,
    bottom: 9,
    gap: 5,
  },
  violateWrapCompact: {
    right: 8,
    bottom: 8,
    gap: 4,
  },
  violateWrapInactive: {
    opacity: 0.78,
  },
  violateCircle: {
    width: 52,
    height: 52,
    borderRadius: 999,
    backgroundColor: '#FF2A32',
    alignItems: 'center',
    justifyContent: 'center',
  },
  violateCircleMedium: {
    width: 46,
    height: 46,
  },
  violateCircleCompact: {
    width: 42,
    height: 42,
  },
  violateCircleInactive: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  violateX: {
    color: '#FFFFFF',
    fontSize: 34,
    lineHeight: 34,
    fontWeight: '900',
    includeFontPadding: false,
  },
  violateXMedium: {
    fontSize: 30,
    lineHeight: 30,
  },
  violateXCompact: {
    fontSize: 26,
    lineHeight: 26,
  },
  violateXInactive: {
    opacity: 0.82,
  },
  violateCount: {
    color: '#FFFFFF',
    textAlign: 'right',
    fontSize: 18,
    fontWeight: '700',
  },
  violateCountMedium: {
    fontSize: 16,
  },
  violateCountCompact: {
    fontSize: 14,
  },
  violateCountInactive: {
    opacity: 0.8,
  },
});

export default memo(GamePlayer);
