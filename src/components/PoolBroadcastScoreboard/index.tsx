import React, {memo, useMemo} from 'react';
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
import {PlayerSettings} from 'types/player';
import {GameSettings} from 'types/settings';
import {isPool10Game, isPool15Game, isPool9Game} from 'utils/game';
import {shouldShowMatchOverlay} from 'utils/matchOverlay';
import useDesignSystem from 'theme/useDesignSystem';

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

const LEFT_PANEL_COLORS = ['#FF5B57', '#CC1212'];
const RIGHT_PANEL_COLORS = ['#CC1212', '#FF5B57'];

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(value, max));
};

const safeNumber = (value: any, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getFlagSource = (player: any) =>
  getWindowsFlagImageSource(normalizePlayerCountry(player));

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
      wrapperWidth: '86%',
      barHeight: liveSize(76),
      bottomGap: Math.round(liveHeight * 0.052),
      playerNameSize: liveSize(27),
      playerScoreSize: liveSize(44),
      centerLabelSize: liveSize(15),
      centerValueSize: liveSize(32),
      timerHeight: liveSize(22),
      timerTextSize: liveSize(15),
      flagWidth: liveSize(56),
      scoreMinWidth: liveSize(92),
      horizontalPadding: liveSize(18),
    };
  }

  if (variant === 'fullscreen') {
    return compact
      ? {
          wrapperWidth: '84%',
          barHeight: s(42),
          bottomGap: s(12),
          playerNameSize: fs(14, 0.78, 0.92),
          playerScoreSize: fs(24, 0.78, 0.94),
          centerLabelSize: fs(9, 0.76, 0.9),
          centerValueSize: fs(17, 0.78, 0.94),
          timerHeight: s(13),
          timerTextSize: fs(10, 0.78, 0.92),
          flagWidth: s(28),
          scoreMinWidth: s(46),
          horizontalPadding: s(10),
        }
      : {
          wrapperWidth: '88%',
          barHeight: s(48),
          bottomGap: s(18),
          playerNameSize: fs(17, 0.8, 0.96),
          playerScoreSize: fs(27, 0.82, 0.98),
          centerLabelSize: fs(10, 0.82, 0.96),
          centerValueSize: fs(20, 0.82, 0.98),
          timerHeight: s(16),
          timerTextSize: fs(11, 0.82, 0.96),
          flagWidth: s(34),
          scoreMinWidth: s(54),
          horizontalPadding: s(12),
        };
  }

  if (variant === 'playback') {
    return {
      wrapperWidth: compact ? '86%' : '90%',
      barHeight: compact ? s(44) : s(50),
      bottomGap: compact ? s(52) : s(62),
      playerNameSize: compact ? fs(15, 0.78, 0.92) : fs(17, 0.82, 0.98),
      playerScoreSize: compact ? fs(24, 0.78, 0.94) : fs(28, 0.82, 0.98),
      centerLabelSize: compact ? fs(9, 0.76, 0.9) : fs(10, 0.82, 0.96),
      centerValueSize: compact ? fs(18, 0.78, 0.94) : fs(21, 0.82, 0.98),
      timerHeight: compact ? s(14) : s(16),
      timerTextSize: compact ? fs(10, 0.78, 0.92) : fs(11, 0.82, 0.96),
      flagWidth: compact ? s(29) : s(34),
      scoreMinWidth: compact ? s(48) : s(56),
      horizontalPadding: compact ? s(10) : s(12),
    };
  }

  return compact
    ? {
        wrapperWidth: '78%',
        barHeight: s(30),
        bottomGap: s(4),
        playerNameSize: fs(10, 0.74, 0.86),
        playerScoreSize: fs(15, 0.74, 0.88),
        centerLabelSize: fs(7, 0.72, 0.84),
        centerValueSize: fs(12, 0.74, 0.86),
        timerHeight: s(10),
        timerTextSize: fs(8, 0.74, 0.86),
        flagWidth: s(20),
        scoreMinWidth: s(32),
        horizontalPadding: s(6),
      }
    : {
        wrapperWidth: '88%',
        barHeight: s(36),
        bottomGap: s(10),
        playerNameSize: fs(13, 0.8, 0.92),
        playerScoreSize: fs(20, 0.8, 0.94),
        centerLabelSize: fs(8, 0.8, 0.92),
        centerValueSize: fs(15, 0.8, 0.94),
        timerHeight: s(12),
        timerTextSize: fs(9, 0.8, 0.92),
        flagWidth: s(24),
        scoreMinWidth: s(40),
        horizontalPadding: s(8),
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
      ]}>
      {flagSource ? (
        <Image source={flagSource} resizeMode="cover" style={styles.flagImage} />
      ) : (
        <Text
          style={[styles.flagText, !active && styles.flagTextInactive]}
          numberOfLines={1}>
          {flagText}
        </Text>
      )}
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
  const category = gameSettings?.category;
  const isSupportedCategory =
    isPool9Game(category) || isPool10Game(category) || isPool15Game(category);
  const playingPlayers = playerSettings?.playingPlayers || [];
  const {adaptive} = useDesignSystem();
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

  const leftPlayer = playingPlayers[0] || {};
  const rightPlayer = playingPlayers[1] || {};
  const bottomValue = bottomOffset ?? metrics.bottomGap;

  const playerNameStyle = useMemo(
    () => [styles.playerName, {fontSize: metrics.playerNameSize}],
    [metrics.playerNameSize],
  );

  const playerScoreStyle = useMemo(
    () => [styles.playerScore, {fontSize: metrics.playerScoreSize}],
    [metrics.playerScoreSize],
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
          width: metrics.wrapperWidth as any,
          bottom: bottomValue,
        },
        style,
      ]}>
      <View style={[styles.topBar, {height: metrics.barHeight}]}>
        <FlagBadge
          player={leftPlayer}
          width={metrics.flagWidth}
          active={currentPlayerIndex === 0}
          side="left"
        />

        <LinearGradient
          colors={LEFT_PANEL_COLORS}
          start={{x: 0, y: 0.5}}
          end={{x: 1, y: 0.5}}
          style={[
            styles.playerPanel,
            styles.playerPanelLeft,
            currentPlayerIndex === 0 && styles.activePlayerPanel,
            {paddingHorizontal: metrics.horizontalPadding},
          ]}>
          <Text
            style={[playerNameStyle, styles.playerNameLeft]}
            numberOfLines={1}>
            {leftPlayer?.name?.trim() || 'Player 1'}
          </Text>
          <View style={[styles.scoreBox, {minWidth: metrics.scoreMinWidth}]}>
            <Text style={playerScoreStyle}>
              {safeNumber(leftPlayer?.totalPoint, 0)}
            </Text>
          </View>
        </LinearGradient>

        <View style={styles.centerPanelWrap}>
          <View style={styles.centerPanel}>
            <Text style={[styles.centerLabel, {fontSize: metrics.centerLabelSize}]}>
              MỤC TIÊU
            </Text>
            <Text style={[styles.centerValue, {fontSize: metrics.centerValueSize}]}>
              {goal}
            </Text>
          </View>
        </View>

        <LinearGradient
          colors={RIGHT_PANEL_COLORS}
          start={{x: 0, y: 0.5}}
          end={{x: 1, y: 0.5}}
          style={[
            styles.playerPanel,
            styles.playerPanelRight,
            currentPlayerIndex === 1 && styles.activePlayerPanel,
            {paddingHorizontal: metrics.horizontalPadding},
          ]}>
          <View style={[styles.scoreBox, {minWidth: metrics.scoreMinWidth}]}>
            <Text style={playerScoreStyle}>
              {safeNumber(rightPlayer?.totalPoint, 0)}
            </Text>
          </View>
          <Text
            style={[playerNameStyle, styles.playerNameRight]}
            numberOfLines={1}>
            {rightPlayer?.name?.trim() || 'Player 2'}
          </Text>
        </LinearGradient>

        <FlagBadge
          player={rightPlayer}
          width={metrics.flagWidth}
          active={currentPlayerIndex === 1}
          side="right"
        />
      </View>

      <View style={[styles.timerTrack, {height: metrics.timerHeight}]}>
        <View
          style={[
            styles.timerFill,
            {
              width: `${fillRatio * 100}%`,
              backgroundColor: timerColor,
            },
          ]}
        />
        <Text style={[styles.timerText, {fontSize: metrics.timerTextSize}]}>
          {baseCountdown > 0 ? `${normalizedCountdown}s` : '--'}
        </Text>
      </View>
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
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: '#161616',
  },
  flagPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  flagPlaceholderLeft: {
    backgroundColor: '#FF5B57',
    borderRightWidth: 1,
    borderRightColor: '#FF5B57',
  },
  flagPlaceholderRight: {
    backgroundColor: '#FF5B57',
    borderLeftWidth: 1,
    borderLeftColor: '#FF5B57',
  },
  flagPlaceholderActive: {
    backgroundColor: '#FF5B57',
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
  playerPanel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  playerPanelLeft: {
    justifyContent: 'space-between',
  },
  playerPanelRight: {
    justifyContent: 'space-between',
  },
  activePlayerPanel: {
    borderTopWidth: 2,
    borderTopColor: '#FF5B57',
    borderBottomWidth: 2,
    borderBottomColor: '#FF5B57',
  },
  playerName: {
    flex: 1,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  playerNameLeft: {
    textAlign: 'left',
    marginRight: 8,
  },
  playerNameRight: {
    textAlign: 'right',
    marginLeft: 8,
  },
  scoreBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: 6,
  },
  playerScore: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  centerPanelWrap: {
    width: 82,
    minWidth: 82,
  },
  centerPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: '#161616',
  },
  centerLabel: {
    color: '#E6E6E6',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  centerValue: {
    color: '#FFFFFF',
    fontWeight: '900',
    marginTop: -2,
  },
  timerTrack: {
    marginTop: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    justifyContent: 'center',
  },
  timerFill: {
    ...StyleSheet.absoluteFillObject,
    right: undefined,
  },
  timerText: {
    color: '#FFFFFF',
    fontWeight: '800',
    textAlign: 'center',
  },
});

export default memo(PoolBroadcastScoreboard);