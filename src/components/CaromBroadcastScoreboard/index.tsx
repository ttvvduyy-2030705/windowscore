import React, {memo} from 'react';
import {Platform, StyleProp, StyleSheet, View, ViewStyle} from 'react-native';

import CaromInfo from 'scenes/game/game-play/console/carom-info';
import {isCaromGame} from 'utils/game';
import {shouldShowMatchOverlay} from 'utils/matchOverlay';
import useDesignSystem from 'theme/useDesignSystem';

type Variant = 'camera' | 'fullscreen' | 'playback' | 'live';

export interface CaromBroadcastScoreboardProps {
  gameSettings?: any;
  playerSettings?: any;
  currentPlayerIndex?: number;
  countdownTime?: number;
  totalTurns?: number;
  variant?: Variant;
  bottomOffset?: number;
  style?: StyleProp<ViewStyle>;
  liveVideoWidth?: number;
  liveVideoHeight?: number;
}

const shouldUseCompactMetrics = (variant: Variant, adaptive?: any) => {
  if (!adaptive?.isLandscape) {
    return false;
  }

  const baseCompact =
    adaptive.layoutPreset === 'phone' ||
    adaptive.isConstrainedLandscape ||
    adaptive.shortSide <= 620;

  if (variant === 'fullscreen') {
    return (
      baseCompact ||
      adaptive.shortSide <= 780 ||
      adaptive.height <= 840 ||
      adaptive.width <= 1280
    );
  }

  return baseCompact;
};

const getMetrics = (
  variant: Variant,
  compact = false,
  adaptive?: any,
  liveVideoWidth = 1920,
  liveVideoHeight = 1080,
) => {
  const s = adaptive?.s || ((value: number) => value);
  const liveWidth = Math.max(1, Number(liveVideoWidth) || 1920);
  const liveHeight = Math.max(1, Number(liveVideoHeight) || 1080);
  const liveScale = Math.min(liveWidth / 1920, liveHeight / 1080);
  const liveCaromSampleWidth = Math.round(liveWidth * 0.28);
  const liveCaromOnlyWidthScale = 0.5;
  const liveCaromWidth = Math.round(liveCaromSampleWidth * liveCaromOnlyWidthScale);
  const liveCaromLeft = Math.round(liveWidth * 0.024);

  switch (variant) {
    case 'live':
      return {
        // Live-only Carom sizing: keep the scoreboard at 50% width,
        // but anchor it back near the original left edge. Pool/logo/camera/
        // fullscreen/replay do not use this branch.
        left: liveCaromLeft,
        bottom: Math.round(liveHeight * 0.04),
        width: liveCaromWidth,
        scale: Math.max(0.62, Math.min(0.78, 0.74 * liveScale)),
      };
    case 'fullscreen':
      return compact
        ? {
            left: s(4),
            bottom: s(4),
            width: s(280),
            scale: 0.46,
          }
        : {
            left: s(6),
            bottom: s(6),
            width: s(360),
            scale: 0.56,
          };
    case 'playback':
      return compact
        ? {
            left: s(10),
            bottom: s(52),
            width: s(360),
            scale: 0.5,
          }
        : {
            left: s(12),
            bottom: s(58),
            width: s(470),
            scale: 0.58,
          };
    case 'camera':
    default:
      return compact
        ? {
            // Camera overlay: pin the Carom scoreboard tight to the normal
            // camera bottom edge without using a negative offset that can clip
            // the lower player row.
            left: s(2),
            bottom: s(0),
            width: s(186),
            scale: 0.34,
          }
        : {
            left: s(4),
            bottom: s(0),
            width: s(236),
            scale: 0.42,
          };
  }
};

const CaromBroadcastScoreboard = ({
  gameSettings,
  playerSettings,
  currentPlayerIndex = 0,
  countdownTime = 0,
  totalTurns = 1,
  variant = 'camera',
  bottomOffset,
  style,
  liveVideoWidth = 1920,
  liveVideoHeight = 1080,
}: CaromBroadcastScoreboardProps) => {
  const category = gameSettings?.category;
  const players = playerSettings?.playingPlayers || [];
  const {adaptive} = useDesignSystem();
  const useCompactMetrics = shouldUseCompactMetrics(variant, adaptive);
  const metrics = getMetrics(
    variant,
    useCompactMetrics,
    adaptive,
    liveVideoWidth,
    liveVideoHeight,
  );
  const scaleRootWidth = metrics.width / metrics.scale;
  // React Native Windows ignores transformOrigin here, so a scaled scoreboard
  // visually drifts toward the center. Pull the scaled root back to keep the
  // camera overlay truly left-aligned. Other platforms keep the previous path.
  const windowsScaleOriginFixX =
    Platform.OS === 'windows'
      ? -Math.round((scaleRootWidth - metrics.width) / 2)
      : 0;

  if (
    !isCaromGame(category) ||
    players.length < 2 ||
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
          left: metrics.left,
          bottom: bottomOffset ?? metrics.bottom,
          width: metrics.width,
        },
        style,
      ]}>
      <View
        style={[
          styles.scaleRoot,
          {
            width: scaleRootWidth,
            marginLeft: windowsScaleOriginFixX,
            transform: [{scale: metrics.scale}],
          },
        ]}>
        <CaromInfo
          isStarted={false}
          isPaused={true}
          isMatchPaused={true}
          goal={Number(gameSettings?.players?.goal?.goal ?? playerSettings?.goal?.goal ?? 0)}
          totalTurns={Math.max(1, Number(totalTurns || 1))}
          countdownTime={Math.max(0, Number(countdownTime || 0))}
          currentPlayerIndex={Math.max(0, Number(currentPlayerIndex || 0))}
          gameSettings={gameSettings}
          playerSettings={playerSettings}
          compact={variant === 'fullscreen' ? useCompactMetrics : false}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    overflow: 'visible',
    zIndex: 18,
    elevation: 18,
    alignItems: 'flex-start',
  },
  scaleRoot: {
    alignSelf: 'flex-start',
    transformOrigin: 'left top' as any,
  },
});

export default memo(CaromBroadcastScoreboard);
