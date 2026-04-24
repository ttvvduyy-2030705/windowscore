import React, {memo, useMemo} from 'react';
import {normalizePlayerCountry} from 'platform/windows/flags';
import {StyleSheet, TextInput, Text as RNText, Image as RNImage} from 'react-native';

import View from 'components/View';
import Button from 'components/Button';
import i18n from 'i18n';
import {BALLS_15} from 'constants/balls';
import {BallType} from 'types/ball';
import {isPool15FreeGame, isPool15Game, isPool15OnlyGame, isPoolGame} from 'utils/game';

import PlayerViewModel, {Props} from './PlayerViewModel';
import {getCountryFlagImageUri} from '../../settings/player/countries';
import useDesignSystem from 'theme/useDesignSystem';
import {createGameplayLayoutRules, createGameplayStyles} from '../layoutRules';
import Pool8BlackBall from '../pool8BlackBall';

const isEnglish = () => {
  const locale = String(
    (i18n as any)?.locale || (i18n as any)?.language || '',
  ).toLowerCase();
  return locale.startsWith('en');
};

const tr = (vi: string, en: string) => (isEnglish() ? en : vi);

const isRemoteUri = (value?: string) =>
  /^https?:\/\//i.test(String(value || '').trim()) ||
  /^file:\/\//i.test(String(value || '').trim());

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

const isLightColor = (value?: string) => {
  const raw = String(value || '').trim().toLowerCase();

  if (!raw) {
    return false;
  }

  if (raw === 'white' || raw === '#fff' || raw === '#ffffff') {
    return true;
  }

  const hex = raw.replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 186;
  }

  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 186;
  }

  const rgbMatch = raw.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 186;
  }

  return false;
};

const GamePlayer = (
  props: Props & {
    layout?: 'default' | 'poolArena';
    compact?: boolean;
    showPool8Tracker?: boolean;
    pool8Tracker?: {sequence: BallType[]; activeIndex: number};
    onPressPool8Ball?: (playerIndex: number) => void;
  },
) => {
  const viewModel = PlayerViewModel(props);
  const isPoolMode = isPoolGame(props.gameSettings?.category);
  const isPool15Mode = isPool15Game(props.gameSettings?.category);
  const isPool15OnlyMode = isPool15OnlyGame(props.gameSettings?.category);
  const isPool15FreeMode = isPool15FreeGame(props.gameSettings?.category);
  const isActiveCard = !!props.isOnTurn;

  const {adaptive, design} = useDesignSystem();
  const layoutRules = useMemo(() => createGameplayLayoutRules(adaptive, design), [adaptive.styleKey]);
  const styles = useMemo(() => createStyles(adaptive, design, layoutRules), [adaptive.styleKey]);
  const totalPlayers = props.totalPlayers || 2;
  const isLargeDisplay = adaptive.layoutPreset === 'tv';
  const isWideLandscape =
    adaptive.isLandscape &&
    (adaptive.layoutPreset === 'wideTablet' ||
      (adaptive.layoutPreset === 'tv' && adaptive.aspectRatio >= 1.5));
  const isHandheldLandscape =
    adaptive.isLandscape && adaptive.systemMetrics.smallestScreenWidthDp < 600;
  const isCompactLandscape =
    adaptive.isLandscape &&
    (adaptive.height <= 720 || adaptive.aspectRatio >= 1.65 || adaptive.widthClass === 'compact');
  const useForcedCompact =
    isCompactLandscape ||
    adaptive.shortSide < 430 ||
    (adaptive.isLandscape && adaptive.height <= 700);

  const isCompactLayout = Boolean(
    props.compact || useForcedCompact || totalPlayers > 2,
  );
  const isMediumResponsiveLayout =
    !isCompactLayout && isWideLandscape && totalPlayers <= 2;

  const isPhoneLandscapeTwoPlayer =
    adaptive.isLandscape &&
    adaptive.height <= 700 &&
    totalPlayers <= 2;

  const isExtraCompactLayout =
    totalPlayers >= 4 ||
    adaptive.shortSide <= 430 ||
    (adaptive.isLandscape && adaptive.height <= 620);

  const uiScale = useMemo(() => {
    if (isLargeDisplay) {
      return 1;
    }

    const shortPenalty = adaptive.isLandscape
      ? Math.max(0, Math.min(0.24, (720 - adaptive.height) / 260))
      : 0;
    const ratioPenalty = adaptive.isLandscape
      ? Math.max(0, Math.min(0.08, (adaptive.aspectRatio - 1.65) * 0.08))
      : 0;

    return Math.max(isHandheldLandscape ? 0.5 : 0.62, Math.min(1, adaptive.textScale - shortPenalty - ratioPenalty));
  }, [adaptive.aspectRatio, adaptive.height, adaptive.isLandscape, adaptive.textScale, isLargeDisplay]);

  const isCaromMode = !isPoolMode;
  const isLibreMode = props.gameSettings?.category === 'libre';
  const totalPointValue = Number(props.player.totalPoint || 0);
  const rawPlayerColor = String((props.player as any)?.color || '').trim();
  const useColoredPanel = Boolean(rawPlayerColor) && isCaromMode;
  const playerPanelColor = useColoredPanel ? rawPlayerColor : '#000000';
  const isLightPlayerPanel = useColoredPanel && isLightColor(playerPanelColor);
  const primaryTextColor = useColoredPanel
    ? isLightPlayerPanel
      ? '#111111'
      : '#FFFFFF'
    : '#FFFFFF';
  const secondaryTextColor = useColoredPanel
    ? isLightPlayerPanel
      ? 'rgba(17,17,17,0.72)'
      : 'rgba(255,255,255,0.82)'
    : '#FFFFFF';
  const inactiveTextColor = useColoredPanel
    ? isLightPlayerPanel
      ? 'rgba(17,17,17,0.52)'
      : 'rgba(255,255,255,0.58)'
    : '#8B8D95';

  const panelDynamicStyle = useColoredPanel
    ? {backgroundColor: playerPanelColor, borderColor: isLightPlayerPanel ? 'rgba(17,17,17,0.28)' : 'rgba(255,255,255,0.18)'}
    : {backgroundColor: '#000000', borderColor: '#FF1818'};

  const addTimeButtonDynamicStyle = isLightPlayerPanel
    ? {
        borderColor: 'rgba(17,17,17,0.5)',
        backgroundColor: 'rgba(17,17,17,0.08)',
      }
    : undefined;
  const addTimeTextDynamicStyle = isLightPlayerPanel
    ? {color: '#111111'}
    : undefined;

  const textColorStyle = {color: primaryTextColor};
  const inactivePlaceholderColor = inactiveTextColor;

  const isMultiPlayerLayout = totalPlayers > 2;
  const hasScoredBalls = Boolean((props.player.scoredBalls || []).length > 0);
  const isFourPlayerScoreLayout = totalPlayers >= 4;
  const isCaromThreePlayerCompactCard =
    isCaromMode && totalPlayers === 3 && props.index > 0;

  const scoreLayerDynamicStyle = isMultiPlayerLayout
    ? isCaromMode
      ? isCaromThreePlayerCompactCard
        ? styles.scoreLayerCaromThreePlayerCompact
        : isFourPlayerScoreLayout
        ? styles.scoreLayerCaromFourPlayer
        : styles.scoreLayerCaromThreePlayer
      : isFourPlayerScoreLayout
      ? styles.scoreLayerPoolFourPlayer
      : styles.scoreLayerPoolThreePlayer
    : isCaromMode
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

  const scoreTextDynamicStyle = isMultiPlayerLayout
    ? isCaromMode
      ? isCaromThreePlayerCompactCard
        ? styles.scoreTextCaromThreePlayerCompact
        : isFourPlayerScoreLayout
        ? styles.scoreTextCaromFourPlayer
        : styles.scoreTextCaromThreePlayer
      : isFourPlayerScoreLayout
      ? styles.scoreTextPoolFourPlayer
      : styles.scoreTextPoolThreePlayer
    : isCaromMode
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

  const showAddTime = extraTimeTurns > 0 && (!isPool15Mode || isPool15OnlyMode);


  const addTimeButtons = useMemo(() => {
    return Array.from({length: extraTimeTurns}, (_, index) => index);
  }, [extraTimeTurns]);

  const poolBallMap = useMemo(() => {
    return BALLS_15.reduce<Record<string, any>>((result, ball) => {
      result[String(ball.number)] = ball;
      return result;
    }, {});
  }, []);

  const showPool8Tracker = Boolean(
    isPool15OnlyMode && props.showPool8Tracker && props.pool8Tracker?.sequence?.length,
  );

  const pool8CurrentTrackerBall = useMemo(() => {
    if (!showPool8Tracker) {
      return undefined;
    }

    const activeIndex = Number(props.pool8Tracker?.activeIndex || 0);
    const number = props.pool8Tracker?.sequence?.[activeIndex];
    if (number == null) {
      return undefined;
    }

    return {
      index: activeIndex,
      number,
      ball: poolBallMap[String(number)],
    };
  }, [poolBallMap, props.pool8Tracker, showPool8Tracker]);

  const playerFlag = getPlayerFlagText(props.player as any);
  const playerFlagImage = getPlayerFlagImageUri(props.player as any);

  const fluidScale = Math.max(isHandheldLandscape ? 0.54 : 0.64, Math.min(1, uiScale));
  const dynamicPanelStyle = {
    paddingHorizontal: Math.round((isPhoneLandscapeTwoPlayer ? design.spacing.xs : isMediumResponsiveLayout ? design.spacing.sm : isCompactLayout ? design.spacing.xs : design.spacing.md) * fluidScale),
    paddingTop: Math.round((isPhoneLandscapeTwoPlayer ? design.spacing.xs : isMediumResponsiveLayout ? design.spacing.sm : isCompactLayout ? design.spacing.xs : design.spacing.md) * fluidScale),
    paddingBottom: Math.round((isPhoneLandscapeTwoPlayer ? design.spacing.xs : isMediumResponsiveLayout ? design.spacing.sm : isCompactLayout ? design.spacing.xs : design.spacing.md) * fluidScale),
    borderRadius: Math.round((isPhoneLandscapeTwoPlayer ? design.radius.lg : isMediumResponsiveLayout ? design.radius.xl : isCompactLayout ? design.radius.lg : layoutRules.panelRadius) * fluidScale),
  };
  const dynamicNameRowStyle = {
    minHeight: Math.round((isCompactLayout ? 46 : isMediumResponsiveLayout ? 54 : 62) * fluidScale),
  };
  const dynamicFlagStyle = {
    width: Math.round((isCompactLayout ? 76 : isMediumResponsiveLayout ? 92 : 112) * fluidScale),
    height: Math.round((isCompactLayout ? 50 : isMediumResponsiveLayout ? 62 : 76) * fluidScale),
    marginRight: Math.round((isCompactLayout ? 10 : 14) * fluidScale),
  };
  const dynamicEditButtonStyle = {
    width: Math.round((isCompactLayout ? 28 : isMediumResponsiveLayout ? 32 : 36) * fluidScale),
    height: Math.round((isCompactLayout ? 28 : isMediumResponsiveLayout ? 32 : 36) * fluidScale),
    marginLeft: Math.round(6 * fluidScale),
  };
  const dynamicStepButtonStyle = {
    minHeight: Math.round((isCompactLayout ? 36 : isMediumResponsiveLayout ? 40 : 46) * fluidScale),
  };
  const scoreTop = isCaromThreePlayerCompactCard
    ? Math.round(92 * fluidScale)
    : Math.round((isPhoneLandscapeTwoPlayer ? 118 : isExtraCompactLayout ? 112 : isCompactLayout ? 122 : isMediumResponsiveLayout ? 146 : 172) * fluidScale);
  const scoreBottom = isCaromThreePlayerCompactCard
    ? Math.round(46 * fluidScale)
    : Math.round((isPhoneLandscapeTwoPlayer ? 64 : isExtraCompactLayout ? 62 : isCompactLayout ? 70 : isMediumResponsiveLayout ? 88 : 104) * fluidScale);

  const pool8BallTop = Math.round(scoreTop + 4 * fluidScale);
  const pool8BallBottom = Math.max(18, Math.round(scoreBottom + 12 * fluidScale));
  const pool8AddTimeTop = Math.max(82, Math.round(scoreTop - 4 * fluidScale));
  const isPool8LeftPlayerLayout = isPool15OnlyMode && props.index === 0;
  const isPool8RightPlayerLayout = isPool15OnlyMode && props.index === 1;

  return (
    <View
      style={[
        styles.panel,
        !isLargeDisplay && styles.panelScaled,
        isMediumResponsiveLayout ? styles.panelMedium : undefined,
        isPhoneLandscapeTwoPlayer ? styles.panelPhoneLandscape : undefined,
        panelDynamicStyle,
        dynamicPanelStyle,
        isActiveCard ? styles.panelActive : styles.panelInactive,
      ]}>
      <View
        style={[
          styles.nameRow,
          isMediumResponsiveLayout ? styles.nameRowMedium : undefined,
          isCompactLayout && styles.nameRowCompact,
          dynamicNameRowStyle,
        ]}>
        {playerFlagImage || playerFlag ? (
          <View
            style={[
              styles.flagBadge,
              isMediumResponsiveLayout ? styles.flagBadgeMedium : undefined,
              isCompactLayout && styles.flagBadgeCompact,
              isActiveCard ? styles.flagBadgeActive : styles.flagBadgeInactive,
              dynamicFlagStyle,
            ]}>
            {playerFlagImage ? (
              <RNImage
                source={{uri: playerFlagImage}}
                resizeMode="cover"
                fadeDuration={0}
                style={styles.flagImage}
              />
            ) : (
              <RNText
                style={[
                  styles.flagText,
                  isMediumResponsiveLayout ? styles.flagTextMedium : undefined,
                  isCompactLayout && styles.flagTextCompact,
                  !isActiveCard && styles.flagTextInactive,
                ]}
                allowFontScaling={false}
                maxFontSizeMultiplier={1}>
                {playerFlag}
              </RNText>
            )}
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
              {fontSize: Math.round(adaptive.fs(42, 0.72, 1.02) * uiScale), lineHeight: Math.round(adaptive.fs(48, 0.72, 1.02) * uiScale)},
              (playerFlagImage || playerFlag) && styles.nameTextWithFlag,
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
              {fontSize: Math.round(adaptive.fs(42, 0.72, 1.02) * uiScale), lineHeight: Math.round(adaptive.fs(48, 0.72, 1.02) * uiScale)},
              (playerFlagImage || playerFlag) && styles.nameTextWithFlag,
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
            dynamicEditButtonStyle,
          ]}>
          <RNText
            style={[
              styles.editText,
              isMediumResponsiveLayout ? styles.editTextMedium : undefined,
              isCompactLayout && styles.editTextCompact,
              textColorStyle,
              !isActiveCard && styles.editTextInactive,
            ]}>
            âœŽ
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
            dynamicStepButtonStyle,
          ]}
          onPress={viewModel.onDecreasePoint}>
          <RNText
            style={[
              styles.stepButtonText,
              {
                fontSize: Math.round((isCompactLayout ? 26 : 30) * uiScale),
                lineHeight: Math.round((isCompactLayout ? 26 : 30) * uiScale),
                textAlign: 'center',
              },
              isMediumResponsiveLayout ? styles.stepButtonTextMedium : undefined,
              isCompactLayout && styles.stepButtonTextCompact,
            ]}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}>
            âˆ’
          </RNText>
        </Button>

        <Button
          style={[
            styles.stepButton,
            isMediumResponsiveLayout ? styles.stepButtonMedium : undefined,
            isCompactLayout && styles.stepButtonCompact,
            dynamicStepButtonStyle,
          ]}
          onPress={viewModel.onIncreasePoint}>
          <RNText
            style={[
              styles.stepButtonText,
              {
                fontSize: Math.round((isCompactLayout ? 26 : 30) * uiScale),
                lineHeight: Math.round((isCompactLayout ? 26 : 30) * uiScale),
                textAlign: 'center',
              },
              isMediumResponsiveLayout ? styles.stepButtonTextMedium : undefined,
              isCompactLayout && styles.stepButtonTextCompact,
            ]}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}>
            +
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
              High run
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
          {top: scoreTop, bottom: scoreBottom},
          isPool15OnlyMode && styles.pool8ScoreLayer,
          isPool8RightPlayerLayout && styles.pool8ScoreLayerMirrored,
          !isActiveCard && styles.scoreLayerInactive,
          isPool15FreeMode && hasScoredBalls && styles.scoreLayerWithScoredBalls,
        ]}
        pointerEvents="none">
        <View
          style={[
            styles.scoreTextBox,
            isMediumResponsiveLayout ? styles.scoreTextBoxMedium : undefined,
            isCompactLayout && styles.scoreTextBoxCompact,
            isMultiPlayerLayout && styles.scoreTextBoxMultiPlayer,
            isFourPlayerScoreLayout && styles.scoreTextBoxFourPlayer,
            isCaromThreePlayerCompactCard &&
              styles.scoreTextBoxCaromThreePlayerCompact,
            isPool15OnlyMode && styles.pool8ScoreTextBox,
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
              textColorStyle,
              isPool15OnlyMode && styles.pool8ScoreText,
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
            isPool15OnlyMode && styles.addTimeStackPool8,
            isPool15OnlyMode && {top: pool8AddTimeTop},
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
                addTimeButtonDynamicStyle,
                !isActiveCard && styles.addTimeButtonInactive,
              ]}>
              <RNText
                style={[
                  styles.addTimeText,
                  isMediumResponsiveLayout ? styles.addTimeTextMedium : undefined,
                  isCompactLayout && styles.addTimeTextCompact,
                  addTimeTextDynamicStyle,
                  !isActiveCard && styles.addTimeTextInactive,
                ]}
                allowFontScaling={false}
                maxFontSizeMultiplier={1}>
                â—·+
              </RNText>
            </Button>
          ))}
        </View>
      ) : null}

      {showPool8Tracker && pool8CurrentTrackerBall?.ball ? (
        <View
          style={[
            styles.pool8CurrentBallWrap,
            isPool8RightPlayerLayout ? styles.pool8CurrentBallWrapMirrored : undefined,
            {top: pool8BallTop, bottom: pool8BallBottom},
            !isActiveCard && styles.pool8TrackerStackInactive,
          ]}>
          <Pool8BlackBall
            key={`pool8-current-${props.index}-${pool8CurrentTrackerBall.index}-${pool8CurrentTrackerBall.number}`}
            number={pool8CurrentTrackerBall.number}
            size={64}
            onPress={isActiveCard ? () => props.onPressPool8Ball?.(props.index) : undefined}
          />
        </View>
      ) : null}

      {isPool15FreeMode && (props.player.scoredBalls || []).length > 0 ? (
        <View
          style={[
            styles.scoredBallStack,
            isPool15FreeMode && styles.scoredBallStackPool15Free,
            isMediumResponsiveLayout ? styles.scoredBallStackMedium : undefined,
            isCompactLayout && styles.scoredBallStackCompact,
            isPool15FreeMode && isMediumResponsiveLayout && styles.scoredBallStackPool15FreeMedium,
            isPool15FreeMode && isCompactLayout && styles.scoredBallStackPool15FreeCompact,
            isPool15FreeMode && styles.scoredBallStackPool15FreeTwoCol,
            isPool15FreeMode && isMediumResponsiveLayout && styles.scoredBallStackPool15FreeTwoColMedium,
            isPool15FreeMode && isCompactLayout && styles.scoredBallStackPool15FreeTwoColCompact,
            !isActiveCard && styles.scoredBallStackInactive,
          ]}>
          {(props.player.scoredBalls || []).map((ball, index) => {
            return (
              <Pool8BlackBall
                key={`player-scored-ball-${ball.number}-${index}`}
                number={ball.number}
                size={isCompactLayout ? 24 : isMediumResponsiveLayout ? 26 : 28}
                style={styles.scoredBallAssetWrap}
              />
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
            {tr('Äá»•i lÆ°á»£t Ä‘Ã¡nh', 'Switch turn')}
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
            {tr('Äá»•i lÆ°á»£t Ä‘Ã¡nh', 'Switch turn')}
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
        <Button
          onPress={viewModel.onViolate}
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
            Ã—
          </RNText>
        </Button>
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

const createStyles = (adaptive: any, design: any, rules: any) => createGameplayStyles(adaptive, {
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
  paddingHorizontal: 0,
  backgroundColor: 'transparent',
  borderWidth: 0,
  borderColor: 'transparent',
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
  width: '106%',
  height: '106%',
  marginLeft: '-3%',
  marginTop: '-3%',
  backgroundColor: 'transparent',
},
  flagText: {
    width: '100%',
    fontSize: 52,
    lineHeight: 56,
    textAlign: 'center',
    includeFontPadding: true,
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
    zIndex: 4,
    elevation: 4,
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
    textAlign: 'center',
    textAlignVertical: 'center',
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
    position: 'absolute',
    left: 0,
    right: 0,
    top: 172,
    bottom: 104,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  scoreLayerMedium: {
    top: 146,
    bottom: 88,
  },
  scoreLayerCompact: {
    top: 122,
    bottom: 70,
  },
  scoreLayerExtraCompact: {
    top: 112,
    bottom: 62,
  },
  scoreLayerPhoneLandscape: {
    top: 118,
    bottom: 64,
  },
  scoreLayerCarom: {
    top: 172,
    bottom: 104,
  },
  scoreLayerCaromCompact: {
    top: 122,
    bottom: 70,
  },
  scoreLayerCaromExtraCompact: {
    top: 112,
    bottom: 62,
  },
  scoreLayerCaromPhoneLandscape: {
    top: 118,
    bottom: 64,
  },
  scoreLayerCaromThreePlayer: {
    top: 132,
    bottom: 56,
  },
  scoreLayerCaromThreePlayerCompact: {
    top: 92,
    bottom: 46,
  },
  scoreLayerCaromFourPlayer: {
    top: 118,
    bottom: 52,
  },
  scoreLayerPoolThreePlayer: {
    top: 124,
    bottom: 56,
  },
  scoreLayerPoolFourPlayer: {
    top: 112,
    bottom: 52,
  },
  scoreLayerInactive: {
    opacity: 0.88,
  },
  scoreLayerWithScoredBalls: {
    right: 44,
  },
  scoreTextBox: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
    overflow: 'visible',
  },
  scoreTextBoxMedium: {
    paddingHorizontal: 8,
  },
  scoreTextBoxCompact: {
    paddingHorizontal: 6,
  },
  scoreTextBoxMultiPlayer: {
    paddingHorizontal: 4,
    paddingTop: 0,
    paddingBottom: 0,
  },
  scoreTextBoxFourPlayer: {
    paddingHorizontal: 2,
  },
  scoreTextBoxCaromThreePlayerCompact: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  scoreText: {
    width: '90%',
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 230,
    lineHeight: 250,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  scoreTextMedium: {
    fontSize: 198,
    lineHeight: 216,
  },
  scoreTextCompact: {
    fontSize: 165,
    lineHeight: 180,
  },
  scoreTextExtraCompact: {
    fontSize: 135,
    lineHeight: 148,
  },
  scoreTextPhoneLandscape: {
    fontSize: 150,
    lineHeight: 164,
  },
  scoreTextCarom: {
    fontSize: 230,
    lineHeight: 250,
  },
  scoreTextCaromCompact: {
    fontSize: 170,
    lineHeight: 186,
  },
  scoreTextCaromExtraCompact: {
    fontSize: 140,
    lineHeight: 154,
  },
  scoreTextCaromPhoneLandscape: {
    fontSize: 150,
    lineHeight: 164,
  },
  scoreTextCaromThreePlayer: {
    fontSize: 104,
    lineHeight: 110,
  },
  scoreTextCaromThreePlayerCompact: {
    fontSize: 72,
    lineHeight: 76,
  },
  scoreTextCaromFourPlayer: {
    fontSize: 78,
    lineHeight: 84,
  },
  scoreTextPoolThreePlayer: {
    fontSize: 96,
    lineHeight: 102,
  },
  scoreTextPoolFourPlayer: {
    fontSize: 76,
    lineHeight: 82,
  },
  scoreTextLibre3Digits: {
    fontSize: 190,
    lineHeight: 206,
  },
  scoreTextLibre4Digits: {
    fontSize: 150,
    lineHeight: 164,
  },
  scoreTextLibre3DigitsCompact: {
    fontSize: 150,
    lineHeight: 164,
  },
  scoreTextLibre4DigitsCompact: {
    fontSize: 120,
    lineHeight: 132,
  },
  scoreTextLibre3DigitsExtraCompact: {
    fontSize: 128,
    lineHeight: 140,
  },
  scoreTextLibre4DigitsExtraCompact: {
    fontSize: 104,
    lineHeight: 116,
  },
  scoreTextLibre3DigitsPhoneLandscape: {
    fontSize: 132,
    lineHeight: 145,
  },
  scoreTextLibre4DigitsPhoneLandscape: {
    fontSize: 106,
    lineHeight: 118,
  },
  scoreTextSingleDigit: {},
  scoreTextSingleDigitMedium: {},
  scoreTextSingleDigitCompact: {},
  scoreTextSingleDigitExtraCompact: {},
  scoreTextSingleDigitPhoneLandscape: {},
  scoreTextDoubleDigit: {},
  scoreTextDoubleDigitMedium: {},
  scoreTextDoubleDigitCompact: {},
  scoreTextDoubleDigitExtraCompact: {},
  scoreTextDoubleDigitPhoneLandscape: {},
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
  addTimeStackPool8: {
    position: 'absolute',
    right: 14,
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 8,
    zIndex: 6,
    elevation: 6,
  },
  pool8ScoreLayer: {
    left: '46%',
    right: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pool8ScoreLayerMirrored: {
    left: 28,
    right: '46%',
  },
  pool8ScoreTextBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  pool8ScoreText: {
    width: '100%',
    fontSize: 170,
    lineHeight: 176,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  pool8TrackerStackInactive: {
    opacity: 0.84,
  },
  pool8CurrentBallWrap: {
    position: 'absolute',
    left: '18%',
    width: 92,
    marginLeft: -46,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
    elevation: 8,
  },
  pool8CurrentBallWrapMirrored: {
    left: undefined,
    right: '18%',
    marginLeft: 0,
    marginRight: -46,
  },
  pool8CurrentBall: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pool8CurrentBallStripe: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 23,
    height: 20,
  },
  pool8CurrentBallText: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '900',
    includeFontPadding: false,
    textAlign: 'center',
  },
  scoredBallStack: {
    position: 'absolute',
    right: 10,
    top: 120,
    gap: 6,
    alignItems: 'center',
  },
  scoredBallStackPool15Free: {
    top: 122,
    right: 8,
    justifyContent: 'flex-start',
    gap: 4,
  },
  scoredBallStackPool15FreeTwoCol: {
    height: 124,
    width: 64,
    flexDirection: 'column',
    flexWrap: 'wrap',
    alignContent: 'space-between',
    justifyContent: 'flex-start',
  },
  scoredBallStackMedium: {
    top: 104,
    gap: 5,
  },
  scoredBallStackPool15FreeMedium: {
    top: 112,
    right: 8,
    gap: 3,
  },
  scoredBallStackPool15FreeTwoColMedium: {
    height: 112,
    width: 58,
  },
  scoredBallStackCompact: {
    top: 92,
    gap: 4,
  },
  scoredBallStackPool15FreeCompact: {
    top: 96,
    right: 6,
    gap: 3,
  },
  scoredBallStackPool15FreeTwoColCompact: {
    height: 104,
    width: 52,
  },
  scoredBallStackInactive: {
    opacity: 0.8,
  },
  scoredBallAssetWrap: {
    backgroundColor: 'transparent',
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
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: '38%',
    minWidth: 180,
    minHeight: 50,
    borderTopRightRadius: 16,
    borderTopLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomLeftRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    zIndex: 4,
    backgroundColor: '#1C1C20',
  },
  playingBadgeMedium: {
    width: '36%',
    minWidth: 150,
    minHeight: 40,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 14,
    paddingHorizontal: 10,
  },
  playingBadgeCompact: {
    width: '34%',
    minWidth: 118,
    minHeight: 34,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 12,
    paddingHorizontal: 8,
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
    lineHeight: 18,
    fontWeight: '700',
    includeFontPadding: false,
    textAlignVertical: 'center',
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

