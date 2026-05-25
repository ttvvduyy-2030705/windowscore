import React, { memo, useContext, useMemo } from 'react';
import {
  Image,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import images from 'assets';
import {
  getFlagImageSource as getWindowsFlagImageSource,
  getFlagText as getWindowsFlagText,
  normalizePlayerCountry,
} from 'platform/windows/flags';
import { PlayerSettings } from 'types/player';
import { GameSettings } from 'types/settings';
import { isPool10Game, isPool15Game, isPool9Game } from 'utils/game';
import { shouldShowMatchOverlay } from 'utils/matchOverlay';
import useDesignSystem from 'theme/useDesignSystem';
import i18n from 'i18n';
import fonts from 'configuration/fonts';
import { LanguageContext } from 'context/language';

type Variant = 'camera' | 'fullscreen' | 'playback' | 'live';

export interface PoolBroadcastScoreboardProps {
  gameSettings?: GameSettings | any;
  playerSettings?: PlayerSettings | any;
  currentPlayerIndex?: number;
  countdownTime?: number;
  variant?: Variant;
  bottomOffset?: number;
  style?: StyleProp<ViewStyle>;
  liveVideoWidth?: number;
  liveVideoHeight?: number;
}

const LEFT_PANEL_COLORS = ['#343434', '#681F24', '#D81B23', '#C9161E'];
const RIGHT_PANEL_COLORS = ['#C9161E', '#D81B23', '#681F24', '#343434'];
const LEFT_PANEL_LOCATIONS = [0, 0.08, 0.24, 1];
const RIGHT_PANEL_LOCATIONS = [0, 0.76, 0.92, 1];

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(value, max));
};

const safeNumber = (value: any, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getHighResolutionFlagSource = (player: any) => {
  const normalizedPlayer = normalizePlayerCountry(player);
  const directImage = String(
    normalizedPlayer?.flagImage || normalizedPlayer?.image || '',
  ).trim();

  if (/^(https?:|file:)/i.test(directImage)) {
    return { uri: directImage };
  }

  const countryCode = String(normalizedPlayer?.countryCode || normalizedPlayer?.flag || '')
    .trim()
    .toLowerCase();

  if (/^[a-z]{2}$/.test(countryCode)) {
    // Dùng ảnh cờ 320px thay vì asset VN 24x24 để tránh bị mờ khi phóng to.
    return { uri: `https://flagcdn.com/w320/${countryCode}.png` };
  }

  return getWindowsFlagImageSource(normalizedPlayer);
};

const getFlagSource = (player: any) => getHighResolutionFlagSource(player);

const getFlagText = (player: any) =>
  getWindowsFlagText(normalizePlayerCountry(player));

const getTimerColor = (countdownTime: number) => {
  if (countdownTime <= 5) {
    return '#FF4D4F';
  }

  if (countdownTime <= 10) {
    return '#F7B500';
  }

  return '#34C759';
};

const PLAYER_NAME_TEXT_SCALE = 1.5;
const PLAYER_SCORE_TEXT_SCALE = 1.62;
const CENTER_LABEL_TEXT_SCALE = 1.5;
const CENTER_VALUE_TEXT_SCALE = 1.5;
const BAR_HEIGHT_SCALE = 1.24;
const CENTER_WIDTH_SCALE = 1.55;
const FLAG_WIDTH_SCALE = 1.18;
const SCORE_BOX_WIDTH_SCALE = 1.18;
const H_PADDING_SCALE = 1.08;
const NAME_GAP_SCALE = 1.08;

const getResolvedWrapperWidth = (variant: Variant, originalWidth: string) => {
  if (variant === 'fullscreen') {
    return '94%';
  }
  if (variant === 'camera') {
    return '90%';
  }
  if (variant === 'playback') {
    return '92%';
  }
  return originalWidth;
};

const shouldUseCompactMetrics = (variant: Variant, adaptive?: any) => {
  if (!adaptive?.isLandscape) {
    return false;
  }

  const baseCompact =
    adaptive.layoutPreset === 'phone' ||
    adaptive.isConstrainedLandscape ||
    adaptive.shortSide <= 620;

  if (variant === 'camera') {
    return (
      baseCompact ||
      adaptive.shortSide <= 780 ||
      adaptive.height <= 840 ||
      adaptive.width <= 1280
    );
  }

  return baseCompact;
};

const getVariantMetrics = (
  variant: Variant,
  compact = false,
  adaptive?: any,
  liveVideoWidth = 1920,
  liveVideoHeight = 1080,
) => {
  const s = adaptive?.s || ((value: number) => value);
  const fs = adaptive?.fs || ((value: number) => value);

  const liveWidth = Math.max(1, Number(liveVideoWidth) || 1920);
  const liveHeight = Math.max(1, Number(liveVideoHeight) || 1080);
  const liveScale = Math.min(liveWidth / 1920, liveHeight / 1080);
  const liveSize = (value: number) => Math.round(value * liveScale);

  if (variant === 'live') {
    return {
      wrapperWidth: '88%',
      barHeight: liveSize(62),
      bottomGap: 0,
      playerNameSize: liveSize(28),
      playerScoreSize: liveSize(42),
      centerLabelSize: liveSize(18),
      centerValueSize: liveSize(28),
      centerWidth: liveSize(158),
      timerWidth: '44%',
      timerHeight: liveSize(0),
      timerTextSize: liveSize(0),
      flagWidth: liveSize(96),
      scoreMinWidth: liveSize(92),
      horizontalPadding: liveSize(18),
      playerNameGap: liveSize(12),
    };
  }

  if (variant === 'fullscreen') {
    return compact
      ? {
          // Small/fullscreen window: keep text bigger, but give the middle
          // score block enough room so "ĐIỂM 9" is not clipped.
          wrapperWidth: '88%',
          barHeight: s(42),
          bottomGap: 0,
          playerNameSize: fs(18, 0.84, 0.98),
          playerScoreSize: fs(30, 0.84, 0.98),
          centerLabelSize: fs(11, 0.82, 0.96),
          centerValueSize: fs(18, 0.84, 0.96),
          centerWidth: s(118),
          timerWidth: '46%',
          timerHeight: s(0),
          timerTextSize: fs(0, 0.78, 0.9),
          flagWidth: s(64),
          scoreMinWidth: s(58),
          horizontalPadding: s(10),
          playerNameGap: s(9),
        }
      : {
          // Large/fullscreen window: larger than the original, but balanced
          // so the bar does not overflow or squeeze the center label.
          wrapperWidth: '90%',
          barHeight: s(50),
          bottomGap: 0,
          playerNameSize: fs(22, 0.86, 1),
          playerScoreSize: fs(36, 0.86, 1),
          centerLabelSize: fs(13, 0.84, 0.98),
          centerValueSize: fs(21, 0.86, 0.98),
          centerWidth: s(142),
          timerWidth: '44%',
          timerHeight: s(0),
          timerTextSize: fs(0, 0.82, 0.96),
          flagWidth: s(78),
          scoreMinWidth: s(68),
          horizontalPadding: s(13),
          playerNameGap: s(11),
        };
  }

  if (variant === 'playback') {
    return {
      wrapperWidth: compact ? '86%' : '90%',
      barHeight: compact ? s(34) : s(40),
      bottomGap: 0,
      playerNameSize: compact ? fs(12, 0.78, 0.9) : fs(15, 0.82, 0.96),
      playerScoreSize: compact ? fs(20, 0.78, 0.92) : fs(24, 0.82, 0.96),
      centerLabelSize: compact ? fs(8, 0.76, 0.9) : fs(9, 0.82, 0.96),
      centerValueSize: compact ? fs(15, 0.78, 0.92) : fs(18, 0.82, 0.96),
      centerWidth: compact ? s(82) : s(96),
      timerWidth: compact ? '46%' : '44%',
      timerHeight: compact ? s(16) : s(19),
      timerTextSize: compact ? fs(9, 0.78, 0.9) : fs(10, 0.82, 0.96),
      flagWidth: compact ? s(50) : s(62),
      scoreMinWidth: compact ? s(42) : s(52),
      horizontalPadding: compact ? s(8) : s(10),
      playerNameGap: compact ? s(8) : s(10),
    };
  }

  return compact
    ? {
        wrapperWidth: '86%',
        barHeight: s(34),
        bottomGap: 0,
        playerNameSize: fs(12.5, 0.78, 0.94),
        playerScoreSize: fs(20.5, 0.78, 0.94),
        centerLabelSize: fs(9.2, 0.76, 0.92),
        centerValueSize: fs(14, 0.78, 0.92),
        centerWidth: s(78),
        timerWidth: '48%',
        timerHeight: s(0),
        timerTextSize: fs(0, 0.74, 0.86),
        flagWidth: s(48),
        scoreMinWidth: s(40),
        horizontalPadding: s(7),
        playerNameGap: s(6),
      }
    : {
        wrapperWidth: '88%',
        barHeight: s(40),
        bottomGap: 0,
        playerNameSize: fs(16.5, 0.84, 0.98),
        playerScoreSize: fs(27.5, 0.84, 0.98),
        centerLabelSize: fs(10.2, 0.82, 0.96),
        centerValueSize: fs(16.5, 0.84, 0.96),
        centerWidth: s(96),
        timerWidth: '46%',
        timerHeight: s(0),
        timerTextSize: fs(0, 0.8, 0.9),
        flagWidth: s(60),
        scoreMinWidth: s(50),
        horizontalPadding: s(9),
        playerNameGap: s(8),
      };
};

const FlagBadge = ({
  player,
  width,
  active,
  side,
}: {
  player: any;
  width: number;
  active: boolean;
  side: 'left' | 'right';
}) => {
  const flagSource = getFlagSource(player);
  const flagText = getFlagText(player);

  return (
    <View
      style={[
        styles.flagPlaceholder,
        side === 'left'
          ? styles.flagPlaceholderLeft
          : styles.flagPlaceholderRight,
        active && styles.flagPlaceholderActive,
        {
          width,
        },
      ]}
    >
      <View style={styles.flagInner}>
        {flagSource ? (
          <Image
            source={flagSource}
            resizeMode="cover"
            fadeDuration={0}
            style={styles.flagImage}
          />
        ) : (
          <Text
            style={[styles.flagText, !active && styles.flagTextInactive]}
            numberOfLines={1}
          >
            {flagText}
          </Text>
        )}
      </View>
    </View>
  );
};

const PoolBroadcastScoreboard = ({
  gameSettings,
  playerSettings,
  currentPlayerIndex = 0,
  countdownTime = 0,
  variant = 'camera',
  bottomOffset,
  style,
  liveVideoWidth = 1920,
  liveVideoHeight = 1080,
}: PoolBroadcastScoreboardProps) => {
  const { language } = useContext(LanguageContext);
  void language;
  const category = gameSettings?.category;
  const isSupportedCategory =
    isPool9Game(category) || isPool10Game(category) || isPool15Game(category);
  const playingPlayers = playerSettings?.playingPlayers || [];
  const { adaptive } = useDesignSystem();
  const useCompactMetrics = shouldUseCompactMetrics(variant, adaptive);
  const metrics = getVariantMetrics(
    variant,
    useCompactMetrics,
    adaptive,
    liveVideoWidth,
    liveVideoHeight,
  );

  const goal = safeNumber(
    gameSettings?.players?.goal?.goal ?? playerSettings?.goal?.goal,
    0,
  );
  const baseCountdown = safeNumber(gameSettings?.mode?.countdownTime, 0);
  const normalizedCountdown = Math.max(0, safeNumber(countdownTime, 0));
  const fillRatio =
    baseCountdown > 0 ? clamp(normalizedCountdown / baseCountdown, 0, 1) : 0;
  const timerColor = getTimerColor(normalizedCountdown);

  const visualBarHeight = Math.round(metrics.barHeight * BAR_HEIGHT_SCALE);
  const visualCenterWidth = Math.round(metrics.centerWidth * CENTER_WIDTH_SCALE);
  const visualFlagWidth = Math.round(metrics.flagWidth * FLAG_WIDTH_SCALE);
  const visualScoreMinWidth = Math.round(metrics.scoreMinWidth * SCORE_BOX_WIDTH_SCALE);
  const visualHorizontalPadding = Math.round(metrics.horizontalPadding * H_PADDING_SCALE);
  const visualPlayerNameGap = Math.round(metrics.playerNameGap * NAME_GAP_SCALE);
  const visualWrapperWidth = getResolvedWrapperWidth(variant, String(metrics.wrapperWidth));
  const visualTimerHeight = Math.max(metrics.timerHeight || 0, Math.round(visualBarHeight * 0.24), 14);
  const visualTimerTextSize = Math.max(8, Math.round(visualTimerHeight * 0.48));
  const visualTimerWidth =
    variant === 'fullscreen' ? '52%' : variant === 'camera' ? '56%' : variant === 'playback' ? '50%' : metrics.timerWidth;
  const visualScoreBoxHeight = Math.max(12, Math.round(visualBarHeight * 0.82));

  const leftPlayer = playingPlayers[0] || {};
  const rightPlayer = playingPlayers[1] || {};
  const bottomValue = bottomOffset ?? metrics.bottomGap;

  const playerNameStyle = useMemo(
    () => [
      styles.playerName,
      {
        fontSize: metrics.playerNameSize * PLAYER_NAME_TEXT_SCALE,
        lineHeight: Math.round(metrics.playerNameSize * PLAYER_NAME_TEXT_SCALE * 1.04),
      },
    ],
    [metrics.playerNameSize],
  );

  const playerScoreStyle = useMemo(
    () => {
      const fontSize = metrics.playerScoreSize * PLAYER_SCORE_TEXT_SCALE * 1.04;

      return [
        styles.playerScore,
        {
          fontSize,
          lineHeight: Math.round(fontSize * 1.02),
          transform: [{ translateY: 3 }],
        },
      ];
    },
    [metrics.playerScoreSize],
  );

  const centerRaceTextStyle = useMemo(
    () => {
      const fontSize = metrics.centerValueSize * CENTER_VALUE_TEXT_SCALE;

      return {
        fontSize,
        lineHeight: Math.round(fontSize * 1.02),
      };
    },
    [metrics.centerValueSize],
  );

  const scoreBoxStyle = useMemo(
    () => [
      styles.scoreBox,
      {
        minWidth: visualScoreMinWidth,
        height: visualScoreBoxHeight,
        minHeight: visualScoreBoxHeight,
      },
    ],
    [visualScoreBoxHeight, visualScoreMinWidth],
  );

  if (
    !isSupportedCategory ||
    playingPlayers.length < 2 ||
    !shouldShowMatchOverlay(gameSettings, playerSettings)
  ) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrapper,
        {
          width: visualWrapperWidth as any,
          bottom: bottomValue,
        },
        style,
      ]}
    >
      <View style={[styles.topBar, { height: visualBarHeight }]}>
        <LinearGradient
          colors={LEFT_PANEL_COLORS}
          locations={LEFT_PANEL_LOCATIONS}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[
            styles.sidePanel,
            styles.sidePanelLeft,
            currentPlayerIndex === 0 && styles.activeSidePanel,
          ]}
        >
          <FlagBadge
            player={leftPlayer}
            width={visualFlagWidth}
            active={currentPlayerIndex === 0}
            side="left"
          />

          <View
            style={[
              styles.playerPanel,
              styles.playerPanelLeft,
              {
                paddingLeft: visualPlayerNameGap,
                paddingRight: visualHorizontalPadding,
              },
            ]}
          >
            <Text
              style={[playerNameStyle, styles.playerNameLeft]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.62}
            >
              {leftPlayer?.name?.trim() || ''}
            </Text>
            <View style={scoreBoxStyle}>
              <Text style={playerScoreStyle} numberOfLines={1}>
                {safeNumber(leftPlayer?.totalPoint, 0)}
              </Text>
            </View>
          </View>
        </LinearGradient>

        <View
          style={[
            styles.centerPanelWrap,
            { width: visualCenterWidth, minWidth: visualCenterWidth },
          ]}
        >
          <View style={styles.centerPanel}>
            <Text
              style={[styles.centerRaceText, centerRaceTextStyle]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.76}
            >
              {`RACE TO ${goal}`}
            </Text>
          </View>
        </View>

        <LinearGradient
          colors={RIGHT_PANEL_COLORS}
          locations={RIGHT_PANEL_LOCATIONS}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[
            styles.sidePanel,
            styles.sidePanelRight,
            currentPlayerIndex === 1 && styles.activeSidePanel,
          ]}
        >
          <View
            style={[
              styles.playerPanel,
              styles.playerPanelRight,
              {
                paddingLeft: visualHorizontalPadding,
                paddingRight: visualPlayerNameGap,
              },
            ]}
          >
            <View style={scoreBoxStyle}>
              <Text style={playerScoreStyle} numberOfLines={1}>
                {safeNumber(rightPlayer?.totalPoint, 0)}
              </Text>
            </View>
            <Text
              style={[playerNameStyle, styles.playerNameRight]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.62}
            >
              {rightPlayer?.name?.trim() || ''}
            </Text>
          </View>

          <FlagBadge
            player={rightPlayer}
            width={visualFlagWidth}
            active={currentPlayerIndex === 1}
            side="right"
          />
        </LinearGradient>
      </View>
      {visualTimerHeight > 0 ? (
        <View
          style={[
            styles.timerTrack,
            { height: visualTimerHeight, width: visualTimerWidth as any },
          ]}
        >
          <View
            style={[
              styles.timerFill,
              {
                width: `${fillRatio * 100}%`,
                backgroundColor: timerColor,
              },
            ]}
          />
          <Text
            style={[
              styles.timerText,
              {
                fontSize: visualTimerTextSize,
                lineHeight: visualTimerHeight,
                height: visualTimerHeight,
              },
            ]}
            numberOfLines={1}
          >
            {baseCountdown > 0 ? `${normalizedCountdown}s` : '--'}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 12,
    elevation: 12,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#3A3A3A',
    borderWidth: 0,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  flagPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'transparent',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  flagPlaceholderLeft: {
    borderTopLeftRadius: 999,
    borderBottomLeftRadius: 999,
  },
  flagPlaceholderRight: {
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
  },
  flagPlaceholderActive: {
    backgroundColor: 'transparent',
  },
  flagInner: {
    width: '100%',
    height: '88%',
    borderRadius: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  flagImage: {
    width: '100%',
    height: '100%',
  },
  flagText: {
    color: '#FFFFFF',
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
  flagTextInactive: {
    opacity: 0.55,
  },
  sidePanel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    minWidth: 0,
  },
  sidePanelLeft: {
    borderTopLeftRadius: 999,
    borderBottomLeftRadius: 999,
  },
  sidePanelRight: {
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
  },
  activeSidePanel: {
    opacity: 1,
  },
  playerPanel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    borderTopWidth: 0,
    borderBottomWidth: 0,
  },
  playerPanelLeft: {
    justifyContent: 'space-between',
  },
  playerPanelRight: {
    justifyContent: 'space-between',
  },
  activePlayerPanel: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  playerName: {
    flex: 1,
    color: '#FFFFFF',
    fontWeight: '700',
    fontFamily: fonts.Nunito.bold,
    letterSpacing: -0.25,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  playerNameLeft: {
    textAlign: 'center',
    marginRight: 10,
  },
  playerNameRight: {
    textAlign: 'center',
    marginLeft: 10,
  },
  scoreBox: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 0,
    paddingHorizontal: 10,
    paddingVertical: 0,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  playerScore: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontFamily: fonts.Nunito.bold,
    includeFontPadding: false,
    textAlign: 'center',
    textAlignVertical: 'center',
    padding: 0,
    margin: 0,
  },
  centerPanelWrap: {
    flexShrink: 0,
  },
  centerPanel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: '#181818',
  },
  centerRaceText: {
    width: '100%',
    color: '#FFFFFF',
    fontWeight: '700',
    fontFamily: fonts.Nunito.bold,
    letterSpacing: 0.1,
    includeFontPadding: false,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  centerLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontFamily: fonts.Nunito.bold,
    letterSpacing: 0.1,
    includeFontPadding: false,
    textAlignVertical: 'center',
    marginRight: 5,
  },
  centerValue: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontFamily: fonts.Nunito.bold,
    letterSpacing: 0.1,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  timerTrack: {
    alignSelf: 'center',
    marginTop: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerFill: {
    ...StyleSheet.absoluteFillObject,
    right: undefined,
  },
  timerText: {
    width: '100%',
    color: '#FFFFFF',
    fontWeight: '700',
    fontFamily: fonts.Nunito.bold,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
    padding: 0,
    margin: 0,
  },
});

export default memo(PoolBroadcastScoreboard);
