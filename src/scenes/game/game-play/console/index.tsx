import React, {memo, useContext, useEffect, useMemo, useRef} from 'react';
import {
  Image as RNImage,
  StyleSheet,
  Text as RNText,
  View as RNView,
} from 'react-native';

import View from 'components/View';
import Text from 'components/Text';
import Button from 'components/Button';
import {BALLS_15} from 'constants/balls';
import {BallType, PoolBallType} from 'types/ball';
import ConsoleViewModel, {ConsoleViewModelProps} from './ConsoleViewModel';
import Webcam, {WebCamHandle} from './webcam';
import {setPoolCameraScoreboardState} from './webcam/poolScoreboardStore';
import {setCaromCameraScoreboardState} from './webcam/caromScoreboardStore';
import CaromInfo from './carom-info';
import {
  isCaromGame,
  isPool15FreeGame,
  isPool15Game,
  isPool15OnlyGame,
  isPoolGame,
} from 'utils/game';
import i18n from 'i18n';
import useDesignSystem from 'theme/useDesignSystem';
import {createGameplayLayoutRules, createGameplayStyles} from '../layoutRules';
import Pool8BlackBall from '../pool8BlackBall';
import images from 'assets';
import {LanguageContext} from 'context/language';

type ActionButtonTone = 'dark' | 'amber' | 'red' | 'green' | 'muted';
type PoolBallButtonSize = 'large' | 'small';

const LEFT_POOL_15_SEQUENCE: BallType[] = [
  BallType.B1,
  BallType.B2,
  BallType.B3,
  BallType.B4,
  BallType.B5,
  BallType.B6,
  BallType.B7,
  BallType.B8,
];

const RIGHT_POOL_15_SEQUENCE: BallType[] = [
  BallType.B10,
  BallType.B11,
  BallType.B12,
  BallType.B13,
  BallType.B14,
  BallType.B15,
  BallType.B8,
  BallType.B8,
];

const BALL_BY_NUMBER = BALLS_15.reduce<Record<string, PoolBallType>>(
  (result, ball) => {
    result[String(ball.number)] = ball;
    return result;
  },
  {},
);

const getPoolBall = (number: BallType) => {
  return BALL_BY_NUMBER[String(number)] || BALLS_15[0];
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const DEBUG_CAROM_LAYOUT = false;
const debugCaromLayout = (...args: any[]) => {
  if (DEBUG_CAROM_LAYOUT) {
    console.log(...args);
  }
};

const isEnglish = () => {
  const locale = String(
    (i18n as any)?.locale || (i18n as any)?.language || '',
  ).toLowerCase();
  return locale.startsWith('en');
};

const tr = (vi: string, en: string) => (isEnglish() ? en : vi);

let styles: any = {};

const buttonToneStyle = (tone: ActionButtonTone) => {
  switch (tone) {
    case 'amber':
      return {
        backgroundColor: '#E2A20A',
        borderColor: '#F1BE4C',
      };
    case 'red':
      return {
        backgroundColor: '#FF1E1E',
        borderColor: '#FF5B5B',
      };
    case 'green':
      return {
        backgroundColor: '#17D42F',
        borderColor: '#40F15A',
      };
    case 'muted':
      return {
        backgroundColor: '#784B53',
        borderColor: '#A76C79',
      };
    default:
      return {
        backgroundColor: '#17181C',
        borderColor: '#2B2D33',
      };
  }
};

const ActionButtonContent = ({
  label,
  icon,
  textStyle,
  iconStyle,
  adjustsFontSizeToFit,
}: {
  label: string;
  icon?: number;
  textStyle: any;
  iconStyle: any;
  adjustsFontSizeToFit?: boolean;
}) => {
  if (!icon) {
    return (
      <RNText
        allowFontScaling={false}
        maxFontSizeMultiplier={1}
        style={textStyle}
        numberOfLines={1}
        adjustsFontSizeToFit={!!adjustsFontSizeToFit}
        minimumFontScale={0.64}
        ellipsizeMode="tail">
        {label}
      </RNText>
    );
  }

  return (
    <RNView style={styles.actionButtonLabelRow}>
      <RNImage
        source={icon}
        resizeMode="contain"
        fadeDuration={0}
        style={[iconStyle, styles.actionButtonIconAligned]}
      />
      <RNText
        allowFontScaling={false}
        maxFontSizeMultiplier={1}
        style={[textStyle, styles.actionButtonTextAligned]}
        numberOfLines={1}
        adjustsFontSizeToFit={!!adjustsFontSizeToFit}
        minimumFontScale={0.64}
        ellipsizeMode="tail">
        {label}
      </RNText>
    </RNView>
  );
};

const SmallActionButton = ({
  label,
  onPress,
  tone = 'dark',
  disabled,
  compact,
  extraCompact,
  poolCompact,
  tight,
}: {
  label: string;
  icon?: number;
  onPress?: () => void;
  tone?: ActionButtonTone;
  disabled?: boolean;
  compact?: boolean;
  extraCompact?: boolean;
  poolCompact?: boolean;
  tight?: boolean;
}) => {
  return (
    <Button
      onPress={disabled ? undefined : onPress}
      style={[
        styles.smallActionButton,
        poolCompact ? styles.poolSmallActionButton : undefined,
        compact ? styles.compactSmallActionButton : undefined,
        extraCompact ? styles.extraCompactSmallActionButton : undefined,
        tight ? styles.tightSmallActionButton : undefined,
        buttonToneStyle(tone),
        disabled ? styles.disabledButton : undefined,
      ]}>
      <RNText
  allowFontScaling={false}
  maxFontSizeMultiplier={1}
  style={[
    styles.smallActionText,
    poolCompact ? styles.poolSmallActionText : undefined,
    compact ? styles.compactSmallActionText : undefined,
    extraCompact ? styles.extraCompactSmallActionText : undefined,
    tight ? styles.tightSmallActionText : undefined,
  ]}
  numberOfLines={1}
  adjustsFontSizeToFit={!!poolCompact || !!tight || !!compact || !!extraCompact}
  minimumFontScale={0.64}
  ellipsizeMode="tail">
  {label}
</RNText>
    </Button>
  );
};

const WideActionButton = ({
  label,
  icon,
  onPress,
  tone = 'amber',
  compact,
  extraCompact,
  poolCompact,
  tight,
}: {
  label: string;
  icon?: number;
  onPress?: () => void;
  tone?: ActionButtonTone;
  compact?: boolean;
  extraCompact?: boolean;
  poolCompact?: boolean;
  tight?: boolean;
}) => {
  return (
    <Button
      onPress={onPress}
      style={[
        styles.wideButton,
        poolCompact ? styles.poolWideButton : undefined,
        compact ? styles.compactWideButton : undefined,
        extraCompact ? styles.extraCompactWideButton : undefined,
        tight ? styles.tightWideButton : undefined,
        buttonToneStyle(tone),
      ]}>
      <ActionButtonContent
        label={label}
        icon={icon}
        textStyle={[
          styles.wideButtonText,
          poolCompact ? styles.poolWideButtonText : undefined,
          compact ? styles.compactWideButtonText : undefined,
          extraCompact ? styles.extraCompactWideButtonText : undefined,
          tight ? styles.tightWideButtonText : undefined,
        ]}
        iconStyle={[
          styles.actionButtonIcon,
          poolCompact ? styles.poolActionButtonIcon : undefined,
          compact ? styles.compactActionButtonIcon : undefined,
          extraCompact ? styles.extraCompactActionButtonIcon : undefined,
          tight ? styles.tightActionButtonIcon : undefined,
        ]}
        adjustsFontSizeToFit={!!poolCompact || !!tight || !!compact || !!extraCompact}
      />
    </Button>
  );
};

const DualButton = ({
  leftLabel,
  rightLabel,
  onLeftPress,
  onRightPress,
  leftTone = 'green',
  rightTone = 'red',
  leftIcon,
  rightIcon,
  compact,
  extraCompact,
  poolCompact,
  tight,
}: {
  leftLabel: string;
  rightLabel: string;
  onLeftPress?: () => void;
  onRightPress?: () => void;
  leftTone?: ActionButtonTone;
  rightTone?: ActionButtonTone;
  leftIcon?: number;
  rightIcon?: number;
  compact?: boolean;
  extraCompact?: boolean;
  poolCompact?: boolean;
  tight?: boolean;
}) => {
  return (
    <View
      direction={'row'}
      style={[
        styles.dualButtonRow,
        compact ? styles.compactDualButtonRow : undefined,
      ]}>
      <Button
        onPress={onLeftPress}
        style={[
          styles.dualButton,
          poolCompact ? styles.poolDualButton : undefined,
          compact ? styles.compactDualButton : undefined,
          extraCompact ? styles.extraCompactDualButton : undefined,
          tight ? styles.tightDualButton : undefined,
          buttonToneStyle(leftTone),
        ]}>
        <ActionButtonContent
          label={leftLabel}
          icon={leftIcon}
          textStyle={[
            styles.dualButtonText,
            poolCompact ? styles.poolDualButtonText : undefined,
            compact ? styles.compactDualButtonText : undefined,
            extraCompact ? styles.extraCompactDualButtonText : undefined,
            tight ? styles.tightDualButtonText : undefined,
          ]}
          iconStyle={[
            styles.dualButtonIcon,
            poolCompact ? styles.poolDualButtonIcon : undefined,
            compact ? styles.compactDualButtonIcon : undefined,
            extraCompact ? styles.extraCompactDualButtonIcon : undefined,
            tight ? styles.tightDualButtonIcon : undefined,
          ]}
          adjustsFontSizeToFit={!!poolCompact || !!tight || !!compact || !!extraCompact}
        />
      </Button>

      <Button
        onPress={onRightPress}
        style={[
          styles.dualButton,
          poolCompact ? styles.poolDualButton : undefined,
          compact ? styles.compactDualButton : undefined,
          extraCompact ? styles.extraCompactDualButton : undefined,
          tight ? styles.tightDualButton : undefined,
          buttonToneStyle(rightTone),
        ]}>
        {rightIcon ? (
          <RNView style={styles.dualButtonLabelRow}>
            <RNImage
              source={rightIcon}
              resizeMode="contain"
              fadeDuration={0}
              style={[
                styles.dualButtonIcon,
                poolCompact ? styles.poolDualButtonIcon : undefined,
                compact ? styles.compactDualButtonIcon : undefined,
                extraCompact ? styles.extraCompactDualButtonIcon : undefined,
                tight ? styles.tightDualButtonIcon : undefined,
                styles.actionButtonIconAligned,
              ]}
            />
            <RNText
              allowFontScaling={false}
              maxFontSizeMultiplier={1}
              style={[
                styles.dualButtonText,
                poolCompact ? styles.poolDualButtonText : undefined,
                compact ? styles.compactDualButtonText : undefined,
                extraCompact ? styles.extraCompactDualButtonText : undefined,
                tight ? styles.tightDualButtonText : undefined,
                styles.actionButtonTextAligned,
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit={!!poolCompact || !!tight || !!compact || !!extraCompact}
              minimumFontScale={0.64}
              ellipsizeMode="tail">
              {rightLabel}
            </RNText>
          </RNView>
        ) : (
          <RNText
            allowFontScaling={false}
            maxFontSizeMultiplier={1}
            style={[
              styles.dualButtonText,
              poolCompact ? styles.poolDualButtonText : undefined,
              compact ? styles.compactDualButtonText : undefined,
              extraCompact ? styles.extraCompactDualButtonText : undefined,
              tight ? styles.tightDualButtonText : undefined,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit={!!poolCompact || !!tight || !!compact || !!extraCompact}
            minimumFontScale={0.64}
            ellipsizeMode="tail">
            {rightLabel}
          </RNText>
        )}
      </Button>
    </View>
  );
};

const TripleButton = ({
  leftLabel,
  centerLabel,
  rightLabel,
  leftIcon,
  centerIcon,
  rightIcon,
  onLeftPress,
  onCenterPress,
  onRightPress,
  leftTone = 'green',
  centerTone = 'amber',
  rightTone = 'muted',
  compact,
  extraCompact,
  poolCompact,
  tight,
}: {
  leftLabel: string;
  centerLabel: string;
  rightLabel: string;
  leftIcon?: number;
  centerIcon?: number;
  rightIcon?: number;
  onLeftPress?: () => void;
  onCenterPress?: () => void;
  onRightPress?: () => void;
  leftTone?: ActionButtonTone;
  centerTone?: ActionButtonTone;
  rightTone?: ActionButtonTone;
  compact?: boolean;
  extraCompact?: boolean;
  poolCompact?: boolean;
  tight?: boolean;
}) => {
  const textStyle = [
    styles.tripleButtonText,
    poolCompact ? styles.poolTripleButtonText : undefined,
    compact ? styles.compactTripleButtonText : undefined,
    extraCompact ? styles.extraCompactTripleButtonText : undefined,
    tight ? styles.tightTripleButtonText : undefined,
  ];
  const iconStyle = [
    styles.actionButtonIcon,
    poolCompact ? styles.poolActionButtonIcon : undefined,
    compact ? styles.compactActionButtonIcon : undefined,
    extraCompact ? styles.extraCompactActionButtonIcon : undefined,
    tight ? styles.tightActionButtonIcon : undefined,
  ];
  const fitText = !!poolCompact || !!tight || !!compact || !!extraCompact;

  return (
    <View
      direction={'row'}
      style={[
        styles.tripleButtonRow,
        compact ? styles.compactTripleButtonRow : undefined,
      ]}>
      <Button
        onPress={onLeftPress}
        style={[
          styles.tripleButton,
          poolCompact ? styles.poolTripleButton : undefined,
          compact ? styles.compactTripleButton : undefined,
          extraCompact ? styles.extraCompactTripleButton : undefined,
          tight ? styles.tightTripleButton : undefined,
          buttonToneStyle(leftTone),
        ]}>
        <ActionButtonContent
          label={leftLabel}
          icon={leftIcon}
          textStyle={textStyle}
          iconStyle={iconStyle}
          adjustsFontSizeToFit={fitText}
        />
      </Button>

      <Button
        onPress={onCenterPress}
        style={[
          styles.tripleButton,
          poolCompact ? styles.poolTripleButton : undefined,
          compact ? styles.compactTripleButton : undefined,
          extraCompact ? styles.extraCompactTripleButton : undefined,
          tight ? styles.tightTripleButton : undefined,
          buttonToneStyle(centerTone),
        ]}>
        <ActionButtonContent
          label={centerLabel}
          icon={centerIcon}
          textStyle={textStyle}
          iconStyle={iconStyle}
          adjustsFontSizeToFit={fitText}
        />
      </Button>

      <Button
        onPress={onRightPress}
        style={[
          styles.tripleButton,
          poolCompact ? styles.poolTripleButton : undefined,
          compact ? styles.compactTripleButton : undefined,
          extraCompact ? styles.extraCompactTripleButton : undefined,
          tight ? styles.tightTripleButton : undefined,
          buttonToneStyle(rightTone),
        ]}>
        <ActionButtonContent
          label={rightLabel}
          icon={rightIcon}
          textStyle={textStyle}
          iconStyle={iconStyle}
          adjustsFontSizeToFit={fitText}
        />
      </Button>
    </View>
  );
};

const PoolBallButton = ({
  ball,
  onPress,
  disabled,
  size = 'large',
}: {
  ball: PoolBallType;
  onPress?: () => void;
  disabled?: boolean;
  size?: PoolBallButtonSize;
}) => {
  const isSmall = size === 'small';
  const isBlackBall = ball.number === BallType.B8;
  const textColor = isBlackBall ? '#FFFFFF' : '#111111';

  return (
    <Button
      onPress={disabled ? undefined : onPress}
      style={[
        styles.poolBallButton,
        isSmall ? styles.poolBallButtonSmall : styles.poolBallButtonLarge,
        {
          backgroundColor: ball.cut ? '#FFFFFF' : ball.color,
          borderColor: ball.color,
        },
        disabled ? styles.disabledButton : undefined,
      ]}>
      {ball.cut ? (
        <View
          style={[
            styles.poolBallStripe,
            isSmall ? styles.poolBallStripeSmall : undefined,
            {backgroundColor: ball.color},
          ]}
        />
      ) : null}
      <RNText
        style={[
          styles.poolBallText,
          isSmall ? styles.poolBallTextSmall : styles.poolBallTextLarge,
          {color: ball.cut ? '#111111' : textColor},
        ]}>
        {ball.number}
      </RNText>
    </Button>
  );
};

const GameConsole = (props: ConsoleViewModelProps) => {
  const {language} = useContext(LanguageContext);
  const viewModel = ConsoleViewModel(props);

  useEffect(() => {
    setPoolCameraScoreboardState({
      currentPlayerIndex: props.currentPlayerIndex,
      countdownTime: props.countdownTime,
      gameSettings: props.gameSettings,
      playerSettings: props.playerSettings,
    });

    setCaromCameraScoreboardState({
      isStarted: props.isStarted,
      isPaused: props.isPaused,
      isMatchPaused: props.isMatchPaused,
      currentPlayerIndex: props.currentPlayerIndex,
      countdownTime: props.countdownTime,
      totalTurns: props.totalTurns,
      gameSettings: props.gameSettings,
      playerSettings: props.playerSettings,
    });
  }, [
    props.isStarted,
    props.isPaused,
    props.isMatchPaused,
    props.currentPlayerIndex,
    props.countdownTime,
    props.totalTurns,
    props.gameSettings,
    props.playerSettings,
  ]);

  const webcamRef = useRef<WebCamHandle>(null);
  const {adaptive, design} = useDesignSystem();
  const layoutRules = useMemo(() => createGameplayLayoutRules(adaptive, design), [adaptive.styleKey]);
  styles = useMemo(() => createStyles(adaptive, design, layoutRules), [adaptive.styleKey]);
  const {width, height, shortSide: shortestSide, longSide: longestSide} = adaptive;
  const isLandscape = adaptive.isLandscape;
  const isLargeDisplay = adaptive.layoutPreset === 'tv';
  const isHandheldLandscape =
    isLandscape && adaptive.systemMetrics.smallestScreenWidthDp < 600;
  const isMediumLandscape =
    isLandscape &&
    !isLargeDisplay &&
    (adaptive.breakpoint === 'medium' ||
      adaptive.layoutPreset === 'tablet' ||
      adaptive.layoutPreset === 'wideTablet');
  const isCompactLandscape =
    isLandscape &&
    (adaptive.breakpoint === 'compact' ||
      adaptive.widthClass === 'compact' ||
      adaptive.isShortLandscape ||
      height <= 760);
  const isShortLandscape = adaptive.isShortLandscape;
  const isVeryShortLandscape = adaptive.isVeryShortLandscape;
  const useResponsiveCompact =
    !isLargeDisplay &&
    (adaptive.breakpoint === 'compact' ||
      adaptive.isConstrainedLandscape ||
      isCompactLandscape ||
      shortestSide <= 520 ||
      (isHandheldLandscape && height <= 900) ||
      height <= 760);
  const useTightLandscapeLayout = isMediumLandscape || useResponsiveCompact;
  const useExtraCompact =
    !isLargeDisplay &&
    (adaptive.isUltraShortLandscape ||
      adaptive.isVeryShortLandscape ||
      shortestSide <= 460 ||
      height <= 680 ||
      (adaptive.breakpoint === 'compact' && height <= 720) ||
      (isHandheldLandscape && height <= 620) ||
      adaptive.aspectRatio >= 1.9);
  const useCompactMiddleHoleCounter = useExtraCompact || useResponsiveCompact;

  const uiScale = useMemo(() => {
    if (isLargeDisplay) {
      return 1;
    }

    const compactPenalty = isVeryShortLandscape ? 0.12 : isShortLandscape ? 0.08 : 0;
    return clamp(adaptive.textScale - compactPenalty, isHandheldLandscape ? 0.56 : 0.68, 1);
  }, [adaptive.textScale, isLargeDisplay, isShortLandscape, isVeryShortLandscape]);

  const category = props.gameSettings?.category;
  const isPool = isPoolGame(category);
  const isCarom = isCaromGame(category);
  const isPool15Free = isPool15FreeGame(category);
  const isPool8Temp = isPool15OnlyGame(category);
  const isPool15 = isPool15Free;
  const isPool15Only = false;
  const usePoolBroadcastLayout = isPool && !isPool15;
  const isPhonePreset = adaptive.layoutPreset === 'phone';
  const isTabletPreset = adaptive.layoutPreset === 'tablet';
  const isWideTabletPreset = adaptive.layoutPreset === 'wideTablet';
  const isTvPreset = adaptive.layoutPreset === 'tv';
  const isFastMode = props.gameSettings?.mode?.mode === 'fast';
  const totalTimeText = viewModel.displayTotalTime();
  const players = props.playerSettings?.playingPlayers || [];
  const totalPlayers = Number(props.totalPlayers || 2);
  const pool8FreeSetWinnerPlayer = props.pool8FreeSetWinnerIndex != null ? players[props.pool8FreeSetWinnerIndex] : undefined;
  const pool8SetWinnerPlayer = props.pool8SetWinnerIndex != null ? players[props.pool8SetWinnerIndex] : undefined;
  const leftHole10Score = Number(props.pool8FreeHole10Scores?.[0] || 0);
  const rightHole10Score = Number(props.pool8FreeHole10Scores?.[1] || 0);
  const hideCaromCamera = isCarom && totalPlayers >= 5;
  const hideCaromScoreChrome = isCarom && totalPlayers >= 3;
  const isCaromLargeCandidate =
    isCarom &&
    !hideCaromCamera &&
    adaptive.isLandscape &&
    !isLargeDisplay &&
    (isTabletPreset || isWideTabletPreset) &&
    shortestSide >= 600 &&
    width >= 960 &&
    height >= 720;
  const useLargeCaromConsole =
    isCaromLargeCandidate &&
    !useExtraCompact;
  const useCaromConsoleCompact =
    isCarom &&
    !hideCaromCamera &&
    adaptive.isLandscape &&
    !isLargeDisplay &&
    !useLargeCaromConsole &&
    (useResponsiveCompact || adaptive.isConstrainedLandscape || isHandheldLandscape || isPhonePreset || height <= 900);
  const useCaromCompactButtons = isCarom
    ? !useLargeCaromConsole && (useResponsiveCompact || useCaromConsoleCompact)
    : useResponsiveCompact;
  const useCaromExtraCompactButtons = isCarom
    ? hideCaromCamera || useExtraCompact || (!useLargeCaromConsole && useCaromConsoleCompact && height <= 780)
    : hideCaromCamera || useExtraCompact;
  const useCaromTightLayout =
    isCarom &&
    !isLargeDisplay &&
    !hideCaromCamera &&
    !useLargeCaromConsole &&
    (useResponsiveCompact || adaptive.isConstrainedLandscape || isHandheldLandscape || height <= 760);
  const shouldCapCaromCameraHeight =
    isCarom &&
    !hideCaromCamera &&
    !hideCaromScoreChrome &&
    !useLargeCaromConsole &&
    adaptive.isLandscape &&
    (adaptive.isUltraShortLandscape ||
      adaptive.isVeryShortLandscape ||
      height <= 700 ||
      (height <= 760 && adaptive.aspectRatio >= 1.7));
  const caromExpectedButtonCount = !isCarom
    ? 0
    : (props.isStarted ? 3 : 1) + 3 + 2;
  const caromGoalCardMinHeight = useMemo(() => {
    if (!isCarom) {
      return null;
    }

    if (useLargeCaromConsole) {
      return 52;
    }

    if (hideCaromCamera) {
      return 56;
    }

    if (useCaromTightLayout) {
      return 34;
    }

    if (useCaromConsoleCompact) {
      return 40;
    }

    return 44;
  }, [hideCaromCamera, isCarom, useCaromConsoleCompact, useCaromTightLayout, useLargeCaromConsole]);

  const caromActionGap = useMemo(() => {
    if (!isCarom) {
      return null;
    }

    if (useLargeCaromConsole) {
      return 8;
    }

    if (useCaromTightLayout) {
      return 2;
    }

    if (useCaromConsoleCompact) {
      return 3;
    }

    return 4;
  }, [isCarom, useCaromConsoleCompact, useCaromTightLayout, useLargeCaromConsole]);

  const caromCameraMaxHeight = useMemo(() => {
    if (!shouldCapCaromCameraHeight) {
      return null;
    }

    if (useCaromTightLayout) {
      return 152;
    }

    if (useCaromConsoleCompact) {
      return 168;
    }

    return null;
  }, [shouldCapCaromCameraHeight, useCaromConsoleCompact, useCaromTightLayout]);

  useEffect(() => {
    if (!isCarom) {
      return;
    }

    debugCaromLayout('[GameConsole] carom layout branch', {
      width,
      height,
      shortestSide,
      layoutPreset: adaptive.layoutPreset,
      widthClass: adaptive.widthClass,
      isPhone: isPhonePreset,
      isTablet: isTabletPreset,
      isWideTablet: isWideTabletPreset,
      isTv: isTvPreset,
      isConstrainedLandscape: adaptive.isConstrainedLandscape,
      heightTriggersResponsiveCompact: height <= 760,
      heightTriggersLegacyTight: height <= 900,
      useResponsiveCompact,
      useExtraCompact,
      isCaromLargeCandidate,
      useLargeCaromConsole,
      isCarom,
      hideCaromCamera,
      hideCaromScoreChrome,
      useCaromConsoleCompact,
      useCaromCompactButtons,
      useCaromExtraCompactButtons,
      useCaromTightLayout,
      expectedButtonCount: caromExpectedButtonCount,
      cameraMinHeight: null,
      goalCardMinHeight: caromGoalCardMinHeight,
      actionStackGap: caromActionGap,
      cameraMaxHeight: caromCameraMaxHeight,
      shouldCapCameraHeight: shouldCapCaromCameraHeight,
      countdownEnabled: !!props.gameSettings?.mode?.countdownTime,
      isStarted: props.isStarted,
    });
  }, [
    adaptive.isConstrainedLandscape,
    adaptive.layoutPreset,
    adaptive.widthClass,
    caromActionGap,
    caromCameraMaxHeight,
    caromExpectedButtonCount,
    caromGoalCardMinHeight,
    height,
    hideCaromCamera,
    hideCaromScoreChrome,
    isCarom,
    isCaromLargeCandidate,
    isPhonePreset,
    isTabletPreset,
    isTvPreset,
    isWideTabletPreset,
    props.gameSettings?.mode?.countdownTime,
    props.isStarted,
    shouldCapCaromCameraHeight,
    shortestSide,
    useCaromCompactButtons,
    useCaromConsoleCompact,
    useCaromExtraCompactButtons,
    useCaromTightLayout,
    useExtraCompact,
    useLargeCaromConsole,
    useResponsiveCompact,
    width,
  ]);

  const leftScore = Number(players[0]?.totalPoint || 0);
  const rightScore = Number(players[1]?.totalPoint || 0);

  const leftBall = useMemo(() => {
    return getPoolBall(
      LEFT_POOL_15_SEQUENCE[
        Math.min(leftScore, LEFT_POOL_15_SEQUENCE.length - 1)
      ],
    );
  }, [leftScore]);

  const rightBall = useMemo(() => {
    return getPoolBall(
      RIGHT_POOL_15_SEQUENCE[
        Math.min(rightScore, RIGHT_POOL_15_SEQUENCE.length - 1)
      ],
    );
  }, [rightScore]);

  const remainingFreeBalls = useMemo(() => {
    if (!isPool15Free) {
      return [] as PoolBallType[];
    }

    const selectedBallNumbers = new Set(
      players.flatMap(player =>
        (player.scoredBalls || []).map(ball => String(ball.number)),
      ),
    );

    return BALLS_15.filter(
      ball => !selectedBallNumbers.has(String(ball.number)),
    );
  }, [isPool15Free, players]);

  const startLabel = useMemo(() => {
    if (!props.isStarted) {
      if (!isFastMode && (props.warmUpCount ?? 0) > 0) {
        return tr(
          `Khởi động (${props.warmUpCount})`,
          `Warm-up (${props.warmUpCount})`,
        );
      }
      return tr('Bắt đầu', 'Start');
    }

    return props.isPaused
      ? tr(
          isCarom || isFastMode ? 'Bắt đầu' : 'Tiếp tục',
          isCarom || isFastMode ? 'Start' : 'Resume',
        )
      : tr('Tạm dừng', 'Pause');
  }, [props.isStarted, props.isPaused, props.warmUpCount, isCarom, isFastMode, language]);

  const handleBottomLeft = () => {
    if (!props.isStarted) {
      if (!isFastMode && (props.warmUpCount ?? 0) > 0) {
        viewModel.onWarmUp();
        return;
      }
      viewModel.onStart();
      return;
    }

    viewModel.onPause();
  };

  const mainActionRow = useMemo(() => {
    if (isFastMode || isPool15) {
      return null;
    }

    if (isCarom) {
      if (!props.isStarted) {
        return (
          <WideActionButton
            label={tr('Đổi người', 'Switch player')}
            icon={images.game.change}
            tone={'amber'}
            onPress={viewModel.onSwapPlayers}
            compact={useCaromCompactButtons}
            extraCompact={useCaromExtraCompactButtons}
            tight={useCaromTightLayout}
          />
        );
      }

      return (
        <TripleButton
          leftLabel={`＋ ${tr('Tăng lượt', 'Increase turns')}`}
          centerLabel={`✚ ${tr('Thêm giờ', 'Extension')}`}
          rightLabel={`－ ${tr('Giảm lượt', 'Decrease turns')}`}
          onLeftPress={props.onIncreaseTotalTurns}
          onCenterPress={viewModel.onPressGiveMoreTime}
          onRightPress={props.onDecreaseTotalTurns}
          leftTone={'green'}
          centerTone={'amber'}
          rightTone={'muted'}
          compact={useCaromCompactButtons}
          extraCompact={useCaromExtraCompactButtons}
          tight={useCaromTightLayout}
        />
      );
    }

    if (isPool && props.isStarted && props.poolBreakEnabled) {
      return (
        <WideActionButton
          label={`↗ ${tr('Phá bi', 'Break shot')}`}
          tone={'green'}
          onPress={props.onPoolBreak}
          compact={useResponsiveCompact}
          poolCompact={usePoolBroadcastLayout}
          extraCompact={useExtraCompact}
        />
      );
    }

    if (isPool && props.isStarted && !props.poolBreakEnabled) {
      return (
        <TripleButton
          leftLabel={`◴ ${tr('Bấm giờ', 'Timer')}`}
          centerLabel={`✚ ${tr('Thêm giờ', 'Extension')}`}
          rightLabel={`▣ ${tr('Ván mới', 'New game')}`}
          onLeftPress={props.onResetTurn}
          onCenterPress={viewModel.onPressGiveMoreTime}
          onRightPress={props.onReset}
          leftTone={'green'}
          centerTone={'amber'}
          rightTone={'muted'}
          compact={useResponsiveCompact}
          poolCompact={usePoolBroadcastLayout}
          extraCompact={useExtraCompact}
        />
      );
    }

    return (
      <WideActionButton
        label={tr('Đổi người', 'Switch players')}
        icon={images.game.change}
        tone={'amber'}
        onPress={viewModel.onSwapPlayers}
        compact={useResponsiveCompact}
        poolCompact={usePoolBroadcastLayout}
        extraCompact={useExtraCompact}
      />
    );
  }, [
    hideCaromCamera,
    isCarom,
    isFastMode,
    isPool,
    isPool15,
    props.isStarted,
    props.poolBreakEnabled,
    props.onPoolBreak,
    props.onResetTurn,
    viewModel.onPressGiveMoreTime,
    props.onReset,
    viewModel.onSwitchTurn,
    viewModel.onSwapPlayers,
    props.onIncreaseTotalTurns,
    props.onDecreaseTotalTurns,
    useExtraCompact,
    usePoolBroadcastLayout,
    useResponsiveCompact,
    useCaromCompactButtons,
    useCaromExtraCompactButtons,
    useCaromTightLayout,
  ]);

  const cameraUtilityRows = (
    <TripleButton
      leftLabel={tr('Làm mới', 'Refresh')}
      centerLabel={tr('Giải lao', 'Break')}
      rightLabel={tr('Đổi cam', 'Switch cam')}
      leftIcon={images.game.refresh}
      centerIcon={images.game.clock}
      rightIcon={images.game.camera}
      onLeftPress={() => webcamRef.current?.refresh()}
      onCenterPress={props.onGameBreak}
      onRightPress={() => webcamRef.current?.switchCamera()}
      leftTone={'dark'}
      centerTone={'dark'}
      rightTone={'dark'}
      compact={isCarom ? useCaromCompactButtons : useResponsiveCompact}
      poolCompact={usePoolBroadcastLayout}
      extraCompact={isCarom ? useCaromExtraCompactButtons : hideCaromCamera || useExtraCompact}
      tight={isCarom ? useCaromTightLayout : false}
    />
  );

  const bottomControls = useMemo(() => {
    if (isPool15) {
      return null;
    }

    if (isCarom) {
      return (
        <DualButton
          leftLabel={startLabel}
          leftIcon={props.isStarted && !props.isPaused ? undefined : images.game.start}
          rightLabel={tr('Kết thúc', 'End')}
          rightIcon={images.game.endMatch}
          onLeftPress={handleBottomLeft}
          onRightPress={viewModel.onStop}
          leftTone={'amber'}
          rightTone={'red'}
          compact={useCaromCompactButtons}
          extraCompact={useCaromExtraCompactButtons}
          tight={useCaromTightLayout}
        />
      );
    }

    return (
      <DualButton
        leftLabel={startLabel}
        leftIcon={props.isStarted && !props.isPaused ? undefined : images.game.start}
        rightLabel={tr('Kết thúc', 'End')}
          rightIcon={images.game.endMatch}
        onLeftPress={handleBottomLeft}
        onRightPress={viewModel.onStop}
        leftTone={'amber'}
        rightTone={'red'}
        compact={useResponsiveCompact}
        poolCompact={usePoolBroadcastLayout}
        extraCompact={useExtraCompact}
      />
    );
  }, [
    handleBottomLeft,
    hideCaromCamera,
    isCarom,
    isPool15,
    props.isPaused,
    props.isStarted,
    props.onGameBreak,
    startLabel,
    useExtraCompact,
    usePoolBroadcastLayout,
    useResponsiveCompact,
    viewModel.onStop,
    useCaromCompactButtons,
    useCaromExtraCompactButtons,
    useCaromTightLayout,
  ]);

  useEffect(() => {
    if (!isCarom) {
      return;
    }

    debugCaromLayout('[GameConsole] carom rendered button rows', {
      utilityButtons: 3,
      mainButtons: props.isStarted ? 3 : 1,
      bottomButtons: 2,
      totalButtons: caromExpectedButtonCount,
      useCaromConsoleCompact,
      useCaromCompactButtons,
      useCaromExtraCompactButtons,
      useCaromTightLayout,
    });
  }, [
    caromExpectedButtonCount,
    isCarom,
    props.isStarted,
    shouldCapCaromCameraHeight,
    useCaromCompactButtons,
    useCaromConsoleCompact,
    useCaromExtraCompactButtons,
    useCaromTightLayout,
  ]);

  const pool15Footer = useMemo(() => {
    if (isPool8Temp) {
      return null;
    }

    if (!isPool15) {
      return null;
    }

    if (props.winner) {
      return (
        <View style={styles.pool15FooterWrap}>
          <View style={styles.pool15WinnerCard}>
            <RNText
              allowFontScaling={false}
              maxFontSizeMultiplier={1}
              style={styles.pool15WinnerText}>
              {tr('Chúc mừng ', 'Congratulations ')}
              {props.winner.name}
              {tr(' đã chiến thắng', ' won')}
            </RNText>
          </View>
          <Button
            style={styles.pool15RestartButton}
            onPress={viewModel.onRestart}>
            <RNText
              allowFontScaling={false}
              maxFontSizeMultiplier={1}
              style={styles.pool15RestartText}>
              {tr('Ván mới', 'New game')}
            </RNText>
          </Button>
        </View>
      );
    }

    if (isPool15Only) {
      return (
        <View style={styles.pool15FooterWrap}>
          <View direction={'row'} style={styles.pool15OnlyRow}>
            <View style={styles.pool15SideWrap}>
              <RNText style={styles.pool15SideScore}>{leftScore}</RNText>
              <PoolBallButton
                ball={leftBall}
                onPress={() => props.onPool15OnlyScore?.(0)}
              />
            </View>

            <View style={styles.pool15CenterWrap}>
              <PoolBallButton ball={getPoolBall(BallType.B8)} disabled />
            </View>

            <View style={styles.pool15SideWrap}>
              <PoolBallButton
                ball={rightBall}
                onPress={() => props.onPool15OnlyScore?.(1)}
              />
              <RNText style={styles.pool15SideScore}>{rightScore}</RNText>
            </View>
          </View>
        </View>
      );
    }

    const freeRows = [
      [BallType.B1, BallType.B2, BallType.B3, BallType.B4, BallType.B5],
      [BallType.B6, BallType.B7, BallType.B8, BallType.B9, BallType.B10],
      [BallType.B11, BallType.B12, BallType.B13, BallType.B14, BallType.B15],
    ];

    return (
      <View style={styles.pool15FooterWrap}>
        <View direction={'row'} style={[styles.pool8FreeFooterRow, useCompactMiddleHoleCounter ? styles.pool8FreeFooterRowCompact : undefined]}>
          <View style={[styles.pool8FreeSideCounter, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterCompact : undefined]}>
            <Button
              style={[styles.pool8FreeSideCounterAdjustButton, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterAdjustButtonCompact : undefined]}
              onPress={() => props.onIncrementPool8FreeHole10?.(0)}>
              <RNText style={[styles.pool8FreeSideCounterAdjustText, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterAdjustTextCompact : undefined]}>+</RNText>
            </Button>
            <View style={[styles.pool8FreeSideCounterBody, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterBodyCompact : undefined]}>
              <RNText style={[styles.pool8FreeSideCounterTitle, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterTitleCompact : undefined]}>{tr('Lỗ giữa', 'Middle pocket')}</RNText>
              <RNText style={[styles.pool8FreeSideCounterValue, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterValueCompact : undefined]}>{leftHole10Score}</RNText>
            </View>
            <Button
              style={[styles.pool8FreeSideCounterAdjustButton, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterAdjustButtonCompact : undefined]}
              onPress={() => props.onDecrementPool8FreeHole10?.(0)}>
              <RNText style={[styles.pool8FreeSideCounterAdjustText, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterAdjustTextCompact : undefined]}>-</RNText>
            </Button>
          </View>

          <View style={styles.pool8FreeCenterWrap}>
            <View style={styles.pool8FreeRowsWrap}>
              {freeRows.map((row, rowIndex) => (
                <View key={`free-row-${rowIndex}`} style={styles.pool8FreeRow}>
                  {row.map(number => {
                    const ball = remainingFreeBalls.find(item => item.number === number);
                    return (
                      <View key={`free-ball-${number}`} style={styles.pool15FreeBallWrap}>
                        {ball ? (
                          <Pool8BlackBall
                            number={ball.number}
                            size={useExtraCompact ? 30 : 38}
                            onPress={() => props.onPoolScore(ball)}
                          />
                        ) : (
                          <View style={styles.pool8FreeBallPlaceholder} />
                        )}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.pool8FreeSideCounter, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterCompact : undefined]}>
            <Button
              style={[styles.pool8FreeSideCounterAdjustButton, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterAdjustButtonCompact : undefined]}
              onPress={() => props.onIncrementPool8FreeHole10?.(1)}>
              <RNText style={[styles.pool8FreeSideCounterAdjustText, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterAdjustTextCompact : undefined]}>+</RNText>
            </Button>
            <View style={[styles.pool8FreeSideCounterBody, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterBodyCompact : undefined]}>
              <RNText style={[styles.pool8FreeSideCounterTitle, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterTitleCompact : undefined]}>{tr('Lỗ giữa', 'Middle pocket')}</RNText>
              <RNText style={[styles.pool8FreeSideCounterValue, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterValueCompact : undefined]}>{rightHole10Score}</RNText>
            </View>
            <Button
              style={[styles.pool8FreeSideCounterAdjustButton, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterAdjustButtonCompact : undefined]}
              onPress={() => props.onDecrementPool8FreeHole10?.(1)}>
              <RNText style={[styles.pool8FreeSideCounterAdjustText, useCompactMiddleHoleCounter ? styles.pool8FreeSideCounterAdjustTextCompact : undefined]}>-</RNText>
            </Button>
          </View>
        </View>
      </View>
    );
  }, [
    isPool15,
    isPool15Only,
    leftBall,
    leftScore,
    props,
    remainingFreeBalls,
    rightBall,
    rightScore,
    useExtraCompact,
    useCompactMiddleHoleCounter,
    viewModel.onRestart,
    leftHole10Score,
    rightHole10Score,
    pool8FreeSetWinnerPlayer,
    pool8SetWinnerPlayer,
    isPool8Temp,
    language,
  ]);

  const timeTextStyle = {
    fontSize: Math.round((isCarom ? 56 : 64) * uiScale),
    lineHeight: Math.round((isCarom ? 60 : 68) * uiScale),
  };

  const metaValueStyle = {
    fontSize: Math.round(30 * uiScale),
    lineHeight: Math.round(34 * uiScale),
  };

  const cameraMinHeight = useMemo(() => {
    if (isPool15) {
      if (useExtraCompact) {
        return 150;
      }

      if (useResponsiveCompact) {
        return 154;
      }

      return isLargeDisplay ? 260 : 176;
    }

    if (isCarom) {
      if (hideCaromScoreChrome) {
        if (useLargeCaromConsole) {
          return 212;
        }

        if (useCaromTightLayout) {
          return isHandheldLandscape ? 156 : 168;
        }

        if (useExtraCompact) {
          return isHandheldLandscape ? 164 : 176;
        }

        if (useCaromConsoleCompact) {
          return isHandheldLandscape ? 176 : 188;
        }

        if (useResponsiveCompact) {
          return isHandheldLandscape ? 184 : 196;
        }

        if (useTightLandscapeLayout) {
          return isHandheldLandscape ? 196 : 208;
        }

        return isLargeDisplay ? 230 : isHandheldLandscape ? 204 : adaptive.isConstrainedLandscape ? 188 : 208;
      }

      if (useLargeCaromConsole) {
        return 164;
      }

      if (useCaromTightLayout) {
        return isHandheldLandscape ? 112 : 120;
      }

      if (useExtraCompact) {
        return isHandheldLandscape ? 124 : 132;
      }

      if (useCaromConsoleCompact) {
        return isHandheldLandscape ? 136 : 146;
      }

      if (useResponsiveCompact) {
        return isHandheldLandscape ? 148 : 160;
      }

      if (useTightLandscapeLayout) {
        return isHandheldLandscape ? 160 : 176;
      }

      return isLargeDisplay ? 210 : isHandheldLandscape ? 172 : adaptive.isConstrainedLandscape ? 160 : 176;
    }

    if (useExtraCompact) {
      return isHandheldLandscape ? 104 : 128;
    }

    if (useResponsiveCompact) {
      return isHandheldLandscape ? 118 : 140;
    }

    if (useTightLandscapeLayout) {
      return isHandheldLandscape ? 128 : 154;
    }

    return isLargeDisplay ? 220 : isHandheldLandscape ? 142 : 176;
  }, [
    isCarom,
    isLargeDisplay,
    isPool15,
    useExtraCompact,
    useResponsiveCompact,
    useTightLandscapeLayout,
    useCaromConsoleCompact,
    useCaromTightLayout,
    useLargeCaromConsole,
    hideCaromScoreChrome,
  ]);

  useEffect(() => {
    if (!isCarom) {
      return;
    }

    debugCaromLayout('[GameConsole] computed carom sizes', {
      cameraMinHeight,
      goalCardMinHeight: caromGoalCardMinHeight,
      actionStackGap: caromActionGap,
      cameraMaxHeight: caromCameraMaxHeight,
      shouldCapCameraHeight: shouldCapCaromCameraHeight,
      isCaromLargeCandidate,
      useLargeCaromConsole,
      useCaromConsoleCompact,
      useCaromCompactButtons,
      useCaromExtraCompactButtons,
      useCaromTightLayout,
      expectedButtonCount: caromExpectedButtonCount,
      isStarted: props.isStarted,
      countdownEnabled: !!props.gameSettings?.mode?.countdownTime,
    });
  }, [
    cameraMinHeight,
    caromActionGap,
    caromCameraMaxHeight,
    caromExpectedButtonCount,
    caromGoalCardMinHeight,
    isCarom,
    isCaromLargeCandidate,
    props.gameSettings?.mode?.countdownTime,
    props.isStarted,
    useCaromCompactButtons,
    useCaromConsoleCompact,
    useCaromExtraCompactButtons,
    useCaromTightLayout,
    useLargeCaromConsole,
  ]);

  const isCameraFullscreen = !!props.cameraFullscreen;

  if (isCarom) {
    return (
      <View
        style={[
          styles.wrapper,
          useTightLandscapeLayout && !useResponsiveCompact
            ? styles.mediumWrapper
            : undefined,
          styles.caromWrapper,
          useResponsiveCompact ? styles.phoneWrapper : undefined,
          useLargeCaromConsole ? styles.caromWrapperLarge : undefined,
          hideCaromCamera ? styles.caromWrapperNoCamera : undefined,
          isCameraFullscreen ? styles.fullscreenWrapper : undefined,
        ]}>
        {props.gameSettings?.mode?.countdownTime && !hideCaromScoreChrome ? (
          <View
            style={[
              styles.caromInfoWrap,
              isCameraFullscreen ? styles.hiddenWhenFullscreen : undefined,
              (useCaromTightLayout || useCaromConsoleCompact) ? styles.caromInfoWrapCompact : undefined,
              useLargeCaromConsole ? styles.caromInfoWrapLarge : undefined,
              hideCaromCamera ? styles.caromInfoWrapNoCamera : undefined,
            ]}>
            <CaromInfo
              isStarted={props.isStarted}
              isPaused={props.isPaused}
              isMatchPaused={props.isMatchPaused}
              goal={props.goal}
              totalTurns={props.totalTurns}
              countdownTime={props.countdownTime}
              currentPlayerIndex={props.currentPlayerIndex}
              gameSettings={props.gameSettings}
              playerSettings={props.playerSettings}
              compact={useCaromTightLayout || useCaromConsoleCompact}
            />
          </View>
        ) : null}

        {!hideCaromCamera ? (
          <View
            style={[
              styles.cameraCard,
              !isCameraFullscreen && useTightLandscapeLayout && !useResponsiveCompact
                ? styles.mediumCameraCard
                : undefined,
              !isCameraFullscreen && useResponsiveCompact ? styles.phoneCameraCard : undefined,
              !isCameraFullscreen ? styles.caromCameraCard : undefined,
              !isCameraFullscreen && useResponsiveCompact ? styles.caromPhoneCameraCard : undefined,
              !isCameraFullscreen && useCaromTightLayout ? styles.caromCameraCardTight : undefined,
              !isCameraFullscreen && useCaromConsoleCompact ? styles.caromCameraCardCompact : undefined,
              !isCameraFullscreen && useLargeCaromConsole ? styles.caromCameraCardLarge : undefined,
              !isCameraFullscreen && hideCaromScoreChrome ? styles.caromCameraCardExpanded : undefined,
              {
                minHeight: isCameraFullscreen ? 0 : cameraMinHeight,
                maxHeight: isCameraFullscreen ? undefined : caromCameraMaxHeight ?? undefined,
              },
              isCameraFullscreen ? styles.fullscreenCameraCard : undefined,
            ]}
            onLayout={event => {
              debugCaromLayout('[GameConsole] carom cameraCard layout', event.nativeEvent.layout);
            }}>
            <Webcam
              ref={webcamRef}
              hideBottomControls
              setIsCameraReady={props.setIsCameraReady}
              isCameraReady={props.isCameraReady}
              webcamFolderName={props.webcamFolderName}
              updateWebcamFolderName={props.updateWebcamFolderName}
              cameraRef={props.cameraRef}
              isPaused={props.isPaused}
              isStarted={props.isStarted}
              youtubeLivePreviewActive={props.youtubeLivePreviewActive}
              forceFullscreen={isCameraFullscreen}
            />
          </View>
        ) : null}

        <View
          style={[
            styles.goalCardFullWidth,
            isCameraFullscreen ? styles.hiddenWhenFullscreen : undefined,
            useTightLandscapeLayout && !useResponsiveCompact
              ? styles.mediumGoalCard
              : undefined,
            styles.caromGoalCardFullWidth,
            useResponsiveCompact ? styles.phoneGoalCard : undefined,
            hideCaromCamera ? styles.caromGoalCardNoCamera : undefined,
            !hideCaromCamera ? styles.caromGoalCardInline : undefined,
            useCaromTightLayout ? styles.caromGoalCardTight : undefined,
            useCaromConsoleCompact ? styles.caromGoalCardCompact : undefined,
            useLargeCaromConsole ? styles.caromGoalCardLarge : undefined,
            isLargeDisplay && !useResponsiveCompact
              ? styles.caromGoalCardLargeDisplay
              : undefined,
          ]}
          onLayout={event => {
            debugCaromLayout('[GameConsole] carom goalCard layout', event.nativeEvent.layout);
          }}>
          {!hideCaromCamera ? (
            <View
              direction={'row'}
              alignItems={'center'}
              justify={'center'}
              style={styles.caromGoalInlineRow}>
              <RNText
                allowFontScaling={false}
                maxFontSizeMultiplier={1}
                style={[
                  styles.metaLabel,
                  styles.caromGoalInlineLabel,
                  {
                    color: '#FFFFFF',
                    fontSize: 18,
                    lineHeight: 22,
                    fontWeight: '800',
                    includeFontPadding: false,
                    textAlignVertical: 'center',
                  },
                ]}>
                {tr('Mục tiêu', 'Goal')}:
              </RNText>
              <RNText
                allowFontScaling={false}
                maxFontSizeMultiplier={1}
                style={[
                  styles.metaValue,
                  styles.metaValueNoLabel,
                  styles.caromGoalInlineValue,
                  metaValueStyle,
                  {
                    color: '#FF2525',
                    fontWeight: '900',
                    includeFontPadding: false,
                    textAlignVertical: 'center',
                  },
                ]}>
                {props.goal}
              </RNText>
            </View>
          ) : (
            <View style={styles.goalRow}>
              <RNText
                allowFontScaling={false}
                maxFontSizeMultiplier={1}
                style={{
                  color: '#FFFFFF',
                  fontSize: 16,
                  lineHeight: 20,
                  fontWeight: '700',
                  includeFontPadding: false,
                  textAlign: 'center',
                  textAlignVertical: 'center',
                }}>
                {tr('Mục tiêu', 'Goal')} :
              </RNText>
              <RNText
                allowFontScaling={false}
                maxFontSizeMultiplier={1}
                style={[
                  styles.metaValue,
                  styles.metaValueNoLabel,
                  metaValueStyle,
                  {
                    color: '#FF2525',
                    fontWeight: '900',
                    includeFontPadding: false,
                    textAlignVertical: 'center',
                  },
                ]}>
                {props.goal}
              </RNText>
            </View>
          )}
        </View>

        <View
          style={[
            styles.actionStack,
            isCameraFullscreen ? styles.hiddenWhenFullscreen : undefined,
            styles.caromActionStack,
            useTightLandscapeLayout && !useResponsiveCompact
              ? styles.mediumActionStack
              : undefined,
            useResponsiveCompact ? styles.phoneActionStack : undefined,
            useCaromTightLayout ? styles.caromActionStackTight : undefined,
            useCaromConsoleCompact ? styles.caromActionStackCompact : undefined,
            useLargeCaromConsole ? styles.caromActionStackLarge : undefined,
            hideCaromCamera ? styles.caromActionStackNoCamera : undefined,
          ]}
          onLayout={event => {
            debugCaromLayout('[GameConsole] carom actionStack layout', event.nativeEvent.layout);
          }}>
          {cameraUtilityRows}
          {mainActionRow}
          {bottomControls}
        </View>
      </View>
    );
  }

  const poolMetaTextStyle = {
    fontSize: Math.round(28 * uiScale),
    lineHeight: Math.round(32 * uiScale),
    includeFontPadding: false,
    textAlignVertical: 'center' as const,
  };



  const poolMetaValueTextStyle = {
    fontSize: Math.round(28 * uiScale),
    lineHeight: Math.round(32 * uiScale),
    includeFontPadding: false,
    textAlignVertical: 'center' as const,
  };

  return (
    <View
      style={[
        styles.wrapper,
        useTightLandscapeLayout && !useResponsiveCompact
          ? styles.mediumWrapper
          : undefined,
        useResponsiveCompact ? styles.phoneWrapper : undefined,
        usePoolBroadcastLayout ? styles.poolWrapper : undefined,
        isCameraFullscreen ? styles.fullscreenWrapper : undefined,
      ]}>
      {isPool15 ? (
        <View style={[styles.topButtonRowWrap, isCameraFullscreen ? styles.hiddenWhenFullscreen : undefined]}>
          <DualButton
            leftLabel={startLabel}
            leftIcon={props.isStarted && !props.isPaused ? undefined : images.game.start}
            rightLabel={tr('Kết thúc', 'End')}
          rightIcon={images.game.endMatch}
            onLeftPress={handleBottomLeft}
            onRightPress={viewModel.onStop}
            leftTone={'amber'}
            rightTone={'red'}
            compact={useResponsiveCompact}
            poolCompact={usePoolBroadcastLayout}
            extraCompact={useExtraCompact}
          />
        </View>
      ) : isPool8Temp && props.isStarted && !props.poolBreakEnabled ? (
        <View style={[styles.topButtonRowWrap, isCameraFullscreen ? styles.hiddenWhenFullscreen : undefined]}>
          <TripleButton
            leftLabel={`${tr('Số lượt', 'Turns')} ${props.totalTurns}`}
            centerLabel={tr('Đổi bi', 'Swap balls')}
            rightLabel={`${tr('Mục tiêu', 'Goal')} ${props.goal}`}
            onCenterPress={props.onSwapPool8Groups}
            leftTone={'dark'}
            centerTone={'amber'}
            rightTone={'dark'}
            compact={useResponsiveCompact}
            poolCompact={usePoolBroadcastLayout}
            extraCompact={useExtraCompact}
          />
        </View>
      ) : usePoolBroadcastLayout ? (
        <View
          direction={'row'}
          style={[
            styles.metaInlineRow,
            isCameraFullscreen ? styles.hiddenWhenFullscreen : undefined,
            useResponsiveCompact ? styles.phoneMetaInlineRow : undefined,
            usePoolBroadcastLayout ? styles.poolMetaInlineRow : undefined,
            usePoolBroadcastLayout && useResponsiveCompact
              ? styles.poolCompactMetaInlineRow
              : undefined,
          ]}>
          <View
            style={[
              styles.metaInlineCard,
              useResponsiveCompact ? styles.phoneMetaInlineCard : undefined,
              styles.poolMetaInlineCard,
              useResponsiveCompact ? styles.poolCompactMetaInlineCard : undefined,
            ]}>
            <View style={styles.metaInlineCombinedRow}>
              <RNText
                allowFontScaling={false}
                maxFontSizeMultiplier={1}
                style={[styles.metaInlineCombinedText, poolMetaTextStyle]}>
                <RNText
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}
                  style={[
                    styles.metaInlineCombinedText,
                    styles.metaInlineCombinedLabelText,
                    poolMetaTextStyle,
                  ]}>
                  {`${tr('Số lượt', 'Turns')}: `}
                </RNText>
                <RNText
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}
                  style={[
                    styles.metaInlineCombinedValueText,
                    poolMetaValueTextStyle,
                  ]}>
                  {props.totalTurns}
                </RNText>
              </RNText>
            </View>
          </View>

          <View
            style={[
              styles.metaInlineCard,
              useResponsiveCompact ? styles.phoneMetaInlineCard : undefined,
              styles.poolMetaInlineCard,
              useResponsiveCompact ? styles.poolCompactMetaInlineCard : undefined,
            ]}>
            <View style={styles.metaInlineCombinedRow}>
              <RNText
                allowFontScaling={false}
                maxFontSizeMultiplier={1}
                style={[styles.metaInlineCombinedText, poolMetaTextStyle]}>
                <RNText
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}
                  style={[
                    styles.metaInlineCombinedText,
                    styles.metaInlineCombinedLabelText,
                    poolMetaTextStyle,
                  ]}>
                  {`${tr('Mục tiêu', 'Goal')}: `}
                </RNText>
                <RNText
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}
                  style={[
                    styles.metaInlineCombinedValueText,
                    poolMetaValueTextStyle,
                  ]}>
                  {props.goal}
                </RNText>
              </RNText>
            </View>
          </View>
        </View>
      ) : (
        <View
          direction={'row'}
          style={[
            styles.metaRow,
            isCameraFullscreen ? styles.hiddenWhenFullscreen : undefined,
            useTightLandscapeLayout && !useResponsiveCompact
              ? styles.mediumMetaRow
              : undefined,
            useResponsiveCompact ? styles.phoneMetaRow : undefined,
            usePoolBroadcastLayout ? styles.poolMetaRow : undefined,
          ]}>
          <View
            style={[
              styles.metaCard,
              useTightLandscapeLayout && !useResponsiveCompact
                ? styles.mediumMetaCard
                : undefined,
              useResponsiveCompact ? styles.phoneMetaCard : undefined,
              usePoolBroadcastLayout ? styles.poolMetaCard : undefined,
            ]}>
            <Text
              color={'#FFFFFF'}
              fontSize={18}
              fontWeight={'800'}
              style={[
                styles.metaLabel,
                useResponsiveCompact ? styles.phoneMetaLabel : undefined,
              ]}>
              {tr('Số lượt', 'Turns')}
            </Text>
            <Text
              color={'#FF2525'}
              fontWeight={'900'}
              style={[
                styles.metaValue,
                metaValueStyle,
                useResponsiveCompact ? styles.phoneMetaValue : undefined,
              ]}>
              {props.totalTurns}
            </Text>
          </View>

          <View
            style={[
              styles.metaCard,
              useTightLandscapeLayout && !useResponsiveCompact
                ? styles.mediumMetaCard
                : undefined,
              useResponsiveCompact ? styles.phoneMetaCard : undefined,
              usePoolBroadcastLayout ? styles.poolMetaCard : undefined,
            ]}>
            <Text
              color={'#FFFFFF'}
              fontSize={18}
              fontWeight={'800'}
              style={[
                styles.metaLabel,
                useResponsiveCompact ? styles.phoneMetaLabel : undefined,
              ]}>
              {tr('Mục tiêu', 'Goal')} :
            </Text>
            <Text
              color={'#FF2525'}
              fontWeight={'900'}
              style={[
                styles.metaValue,
                metaValueStyle,
                useResponsiveCompact ? styles.phoneMetaValue : undefined,
              ]}>
              {props.goal}
            </Text>
          </View>
        </View>
      )}

      <View
        style={[
          styles.cameraCard,
          useTightLandscapeLayout && !useResponsiveCompact
            ? styles.mediumCameraCard
            : undefined,
          useResponsiveCompact ? styles.phoneCameraCard : undefined,
          isPool15 ? styles.pool15CameraCard : undefined,
          usePoolBroadcastLayout ? styles.poolCameraCard : undefined,
          {minHeight: cameraMinHeight},
          isCameraFullscreen ? styles.fullscreenCameraCard : undefined,
        ]}>
        <Webcam
          ref={webcamRef}
          hideBottomControls
          setIsCameraReady={props.setIsCameraReady}
          isCameraReady={props.isCameraReady}
          webcamFolderName={props.webcamFolderName}
          updateWebcamFolderName={props.updateWebcamFolderName}
          cameraRef={props.cameraRef}
          isPaused={props.isPaused}
          isStarted={props.isStarted}
          youtubeLivePreviewActive={props.youtubeLivePreviewActive}
          gameSettings={props.gameSettings}
          forceFullscreen={isCameraFullscreen}
        />
      </View>

      {!isPool15 ? (
        <View
          style={[
            styles.actionStack,
            isCameraFullscreen ? styles.hiddenWhenFullscreen : undefined,
            useTightLandscapeLayout && !useResponsiveCompact
              ? styles.mediumActionStack
              : undefined,
            useResponsiveCompact ? styles.phoneActionStack : undefined,
            usePoolBroadcastLayout ? styles.poolActionStack : undefined,
            usePoolBroadcastLayout && useResponsiveCompact
              ? styles.poolCompactActionStack
              : undefined,
          ]}>
          {cameraUtilityRows}
          {mainActionRow}
          {bottomControls}
        </View>
      ) : null}

      {!isCameraFullscreen ? pool15Footer : null}
    </View>
  );
};

const createStyles = (adaptive: any, design: any, rules: any) => {
  const isPoolButtonTextCompact =
    adaptive.isLandscape &&
    (adaptive.width < 1440 ||
      adaptive.height <= 860 ||
      adaptive.isConstrainedLandscape ||
      adaptive.widthClass === 'compact' ||
      adaptive.breakpoint === 'compact');
  const isPoolButtonTextTight =
    adaptive.isLandscape &&
    (adaptive.width < 1220 ||
      adaptive.height <= 760 ||
      adaptive.isVeryShortLandscape ||
      adaptive.isUltraShortLandscape ||
      adaptive.aspectRatio >= 1.85);

  const poolMainButtonFontSize = isPoolButtonTextTight
    ? 18
    : isPoolButtonTextCompact
      ? 21
      : 24;
  const poolUtilityButtonFontSize = isPoolButtonTextTight
    ? 16
    : isPoolButtonTextCompact
      ? 18
      : 20;
  const poolMainButtonLineHeight = poolMainButtonFontSize + 3;
  const poolUtilityButtonLineHeight = poolUtilityButtonFontSize + 3;
  const poolMainButtonIconSize = isPoolButtonTextTight
    ? 18
    : isPoolButtonTextCompact
      ? 21
      : 23;
  const poolUtilityButtonIconSize = isPoolButtonTextTight
    ? 16
    : isPoolButtonTextCompact
      ? 18
      : 20;

  return createGameplayStyles(adaptive, {
  wrapper: {
    width: '100%',
    flex: 1,
    backgroundColor: '#0F1013',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#2C2F35',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 4,
  },
  fullscreenWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    alignSelf: 'stretch',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    backgroundColor: '#000000',
    borderRadius: 0,
    borderWidth: 0,
    borderColor: 'transparent',
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  hiddenWhenFullscreen: {
    display: 'none',
  },
  phoneWrapper: {
    paddingHorizontal: 5,
    paddingTop: 5,
    paddingBottom: 5,
    gap: 4,
  },
  mediumWrapper: {
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 6,
    gap: 4,
  },
  poolWrapper: {
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 4,
  },
  caromWrapper: {
    backgroundColor: '#111216',
    minHeight: 0,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8,
  },
  caromWrapperNoCamera: {
    justifyContent: 'space-between',
  },
  caromWrapperLarge: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 6,
    gap: 8,
  },
  timeWrap: {
    width: '100%',
  },
  phoneTimeWrap: {},
  mediumTimeWrap: {},
  caromTimeWrap: {},
  caromTimeWrapNoCamera: {},
  timeCard: {
    width: '100%',
    minHeight: 66,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2C2F35',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#17181C',
    paddingHorizontal: 12,
  },
  phoneTimeCard: {
    minHeight: 50,
    borderRadius: 12,
    paddingHorizontal: 8,
  },
  mediumTimeCard: {
    minHeight: 56,
    borderRadius: 14,
    paddingHorizontal: 10,
  },
  poolTimeCard: {
    minHeight: 58,
    borderRadius: 16,
    paddingHorizontal: 10,
  },
  caromTimeCard: {
    backgroundColor: '#1A1315',
  },
  timeText: {
    color: '#FF2D2D',
    fontWeight: '900',
    textAlign: 'center',
    includeFontPadding: false,
  },
  phoneTimeText: {},
  caromTimeText: {
    color: '#FF3A3A',
  },
  phoneCaromTimeText: {},
  caromTimeTextNoCamera: {},
  metaRow: {
    width: '100%',
    gap: 8,
  },
  phoneMetaRow: {
    gap: 6,
  },
  mediumMetaRow: {
    gap: 6,
  },
  poolMetaRow: {
    gap: 6,
  },
  metaInlineRow: {
    width: '100%',
    gap: 6,
  },
  phoneMetaInlineRow: {
    gap: 5,
  },
  poolMetaInlineRow: {
    gap: 10,
  },
  poolCompactMetaInlineRow: {
    gap: 5,
  },
  metaInlineCard: {
    flex: 1,
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2C2F35',
    backgroundColor: '#17181C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  phoneMetaInlineCard: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  poolMetaInlineCard: {
    minHeight: 60,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  poolCompactMetaInlineCard: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  metaInlineTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 8,
  },
  metaInlineText: {
    color: '#FFFFFF',
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  metaInlineCombinedText: {
    color: '#FFFFFF',
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  metaInlineCombinedRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  metaInlineCombinedLabelText: {
    marginRight: 0,
  },
  metaInlineValueText: {
    color: '#FF2525',
    fontWeight: '900',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  metaInlineCombinedValueText: {
    color: '#FF2525',
    fontWeight: '900',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  metaCard: {
    flex: 1,
    minHeight: 62,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2C2F35',
    backgroundColor: '#17181C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  phoneMetaCard: {
    minHeight: 50,
    borderRadius: 11,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  mediumMetaCard: {
    minHeight: 52,
    borderRadius: 13,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  poolMetaCard: {
    minHeight: 54,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  metaLabel: {
    textAlign: 'center',
    opacity: 0.9,
  },
  phoneMetaLabel: {},
  metaValue: {
    marginTop: 4,
    textAlign: 'center',
    includeFontPadding: false,
  },
  phoneMetaValue: {},
  metaValueNoLabel: {
    marginTop: 0,
  },
  goalRow: {
    width: '100%',
    gap: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caromGoalInlineRow: {
    gap: 10,
  },
  caromGoalInlineLabel: {
    opacity: 0.9,
  },
  caromGoalInlineValue: {},
  cameraCard: {
    width: '100%',
    flex: 0.98,
    minHeight: 236,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 5,
    borderColor: '#383B40',
    backgroundColor: '#141518',
  },
  fullscreenCameraCard: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    flex: 1,
    flexShrink: 0,
    alignSelf: 'stretch',
    borderRadius: 0,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: '#000000',
    zIndex: 1000,
    elevation: 1000,
    margin: 0,
    padding: 0,
  },
  phoneCameraCard: {
    minHeight: 170,
    borderRadius: 16,
  },
  mediumCameraCard: {
    minHeight: 188,
    borderRadius: 18,
    borderWidth: 4,
  },
  caromCameraCard: {
    flex: 1,
    flexShrink: 1,
    minHeight: 0,
  },
  caromCameraCardCompact: {
    borderWidth: 4,
  },
  caromCameraCardExpanded: {
    flex: 1.7,
    maxHeight: undefined,
  },
  caromCameraCardLarge: {
    flex: 1.22,
    maxHeight: undefined,
    borderWidth: 4,
  },
  caromCameraCardTight: {
    flex: 1,
  },
  caromPhoneCameraCard: {
    minHeight: 178,
  },
  poolCameraCard: {
    flex: 1.02,
    borderRadius: 18,
    borderWidth: 4,
    minHeight: 176,
  },
  pool15CameraCard: {
    flex: 1,
    minHeight: 180,
  },
  actionStack: {
    width: '100%',
    alignSelf: 'stretch',
    gap: 8,
    paddingBottom: 0,
  },
  phoneActionStack: {
    gap: 4,
  },
  mediumActionStack: {
    gap: 4,
  },
  poolActionStack: {
    gap: 12,
    paddingTop: 6,
  },
  poolCompactActionStack: {
    gap: 4,
    paddingTop: 2,
  },
  caromActionStack: {
    gap: 8,
    flexShrink: 0,
    paddingTop: 4,
  },
  caromActionStackCompact: {
    gap: 3,
  },
  caromActionStackTight: {
    gap: 2,
  },
  caromActionStackNoCamera: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  caromActionStackLarge: {
    gap: 10,
    paddingTop: 6,
  },
  topButtonRowWrap: {
    width: '100%',
  },
  smallActionButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  compactSmallActionButton: {
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  extraCompactSmallActionButton: {
    minHeight: 38,
    borderRadius: 9,
    paddingHorizontal: 6,
  },
  tightSmallActionButton: {
    minHeight: 34,
    borderRadius: 8,
    paddingHorizontal: 4,
  },
  poolSmallActionButton: {
    minHeight: 72,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  smallActionText: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 21,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  compactSmallActionText: {
    fontSize: 15,
  },
  extraCompactSmallActionText: {
    fontSize: 13,
  },
  tightSmallActionText: {
    fontSize: 12,
    lineHeight: 14,
  },
  poolSmallActionText: {
    fontSize: poolUtilityButtonFontSize,
    fontWeight: '900',
    lineHeight: poolUtilityButtonLineHeight,
    letterSpacing: -0.15,
  },
  wideButton: {
    width: '100%',
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  compactWideButton: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  extraCompactWideButton: {
    minHeight: 38,
    borderRadius: 9,
    paddingHorizontal: 6,
  },
  tightWideButton: {
    minHeight: 34,
    borderRadius: 9,
    paddingHorizontal: 6,
  },
  poolWideButton: {
    minHeight: 84,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  wideButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 23,
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  compactWideButtonText: {
    fontSize: 16,
    lineHeight: 18,
  },
  extraCompactWideButtonText: {
    fontSize: 14,
    lineHeight: 16,
  },
  tightWideButtonText: {
    fontSize: 13,
    lineHeight: 15,
  },
  poolWideButtonText: {
    fontSize: poolMainButtonFontSize,
    fontWeight: '900',
    lineHeight: poolMainButtonLineHeight,
    letterSpacing: -0.2,
  },
  dualButtonRow: {
    width: '100%',
    gap: 6,
  },
  compactDualButtonRow: {
    gap: 6,
    flexWrap: 'nowrap',
  },
  dualButton: {
    flex: 1,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  compactDualButton: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 8,
    minWidth: 0,
  },
  extraCompactDualButton: {
    minHeight: 38,
    borderRadius: 9,
    paddingHorizontal: 6,
    minWidth: 0,
  },
  tightDualButton: {
    minHeight: 34,
    borderRadius: 9,
    paddingHorizontal: 6,
  },
  poolDualButton: {
    minHeight: 84,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  actionButtonLabelRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
  },
  actionButtonIcon: {
    width: 18,
    height: 18,
    flexShrink: 0,
    backgroundColor: 'transparent',
  },
  actionButtonIconAligned: {
    alignSelf: 'center',
    transform: [{translateY: 1}],
  },
  actionButtonTextAligned: {
    flexShrink: 1,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  compactActionButtonIcon: {
    width: 15,
    height: 15,
  },
  extraCompactActionButtonIcon: {
    width: 13,
    height: 13,
  },
  tightActionButtonIcon: {
    width: 12,
    height: 12,
  },
  poolActionButtonIcon: {
    width: poolUtilityButtonIconSize,
    height: poolUtilityButtonIconSize,
  },
  dualButtonLabelRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
  },
  dualButtonIcon: {
    width: 20,
    height: 20,
    flexShrink: 0,
    backgroundColor: 'transparent',
  },
  compactDualButtonIcon: {
    width: 17,
    height: 17,
  },
  extraCompactDualButtonIcon: {
    width: 15,
    height: 15,
  },
  tightDualButtonIcon: {
    width: 14,
    height: 14,
  },
  poolDualButtonIcon: {
    width: poolMainButtonIconSize,
    height: poolMainButtonIconSize,
  },
  dualButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 23,
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  compactDualButtonText: {
    fontSize: 16,
    lineHeight: 18,
  },
  extraCompactDualButtonText: {
    fontSize: 14,
    lineHeight: 16,
  },
  tightDualButtonText: {
    fontSize: 13,
    lineHeight: 15,
  },
  poolDualButtonText: {
    fontSize: poolMainButtonFontSize,
    fontWeight: '900',
    lineHeight: poolMainButtonLineHeight,
    letterSpacing: -0.2,
  },
  tripleButtonRow: {
    width: '100%',
    gap: 6,
  },
  compactTripleButtonRow: {
    gap: 6,
    flexWrap: 'nowrap',
  },
  tripleButton: {
    flex: 1,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  compactTripleButton: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 6,
    minWidth: 0,
  },
  extraCompactTripleButton: {
    minHeight: 38,
    borderRadius: 9,
    paddingHorizontal: 5,
    minWidth: 0,
  },
  tightTripleButton: {
    minHeight: 34,
    borderRadius: 9,
    paddingHorizontal: 4,
  },
  poolTripleButton: {
    minHeight: 72,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  tripleButtonText: {
    color: '#FFFFFF',
    fontSize: 19,
    lineHeight: 22,
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  compactTripleButtonText: {
    fontSize: 15,
    lineHeight: 17,
  },
  extraCompactTripleButtonText: {
    fontSize: 13,
    lineHeight: 15,
  },
  tightTripleButtonText: {
    fontSize: 12,
    lineHeight: 14,
  },
  poolTripleButtonText: {
    fontSize: poolUtilityButtonFontSize,
    fontWeight: '900',
    lineHeight: poolUtilityButtonLineHeight,
    letterSpacing: -0.15,
  },
  disabledButton: {
    opacity: 0.5,
  },
  goalCardFullWidth: {
    width: '100%',
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2C2F35',
    backgroundColor: '#17181C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  caromGoalCardFullWidth: {},
  phoneGoalCard: {
    minHeight: 46,
    borderRadius: 11,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  mediumGoalCard: {
    minHeight: 50,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  caromGoalCardNoCamera: {},
  caromGoalCardInline: {
    minHeight: 44,
    paddingVertical: 4,
  },
  caromGoalCardCompact: {
    minHeight: 40,
    paddingVertical: 3,
  },
  caromGoalCardTight: {
    minHeight: 34,
    paddingVertical: 2,
  },
  caromGoalCardLargeDisplay: {},
  caromGoalCardLarge: {
    minHeight: 58,
    paddingVertical: 7,
  },
  caromInfoWrap: {
    width: '100%',
    flexShrink: 0,
  },
  caromInfoWrapCompact: {
    marginBottom: 0,
  },
  caromInfoWrapLarge: {
    marginBottom: 4,
  },
  caromInfoWrapNoCamera: {},
  poolBallButton: {
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  poolBallButtonLarge: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  poolBallButtonSmall: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  poolBallStripe: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '31%',
    height: '38%',
  },
  poolBallStripeSmall: {},
  poolBallText: {
    fontWeight: '900',
    includeFontPadding: false,
  },
  poolBallTextLarge: {
    fontSize: 18,
    lineHeight: 18,
  },
  poolBallTextSmall: {
    fontSize: 14,
    lineHeight: 14,
  },
  pool15FooterWrap: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2C2F35',
    backgroundColor: '#141518',
    padding: 10,
    gap: 10,
  },
  pool15WinnerCard: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: '#17181C',
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  pool15WinnerText: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
  },
  pool15RestartButton: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FF5B5B',
    backgroundColor: '#FF1E1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pool15RestartText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  pool15OnlyRow: {
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  pool15SideWrap: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  pool15SideScore: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
  },
  pool15CenterWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pool15FreeGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  pool15FreeBallWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  pool8FreeFooterRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  pool8FreeFooterRowCompact: {
    gap: 4,
  },
  pool8FreeSideCounter: {
    width: 64,
    minHeight: 108,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2C2F35',
    backgroundColor: '#17181C',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 4,
    gap: 4,
    flexShrink: 0,
  },
  pool8FreeSideCounterCompact: {
    width: 48,
    minHeight: 88,
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 3,
    gap: 2,
  },
  pool8FreeSideCounterAdjustButton: {
    width: '100%',
    minHeight: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3A3E46',
    backgroundColor: '#101116',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 0,
  },
  pool8FreeSideCounterAdjustButtonCompact: {
    minHeight: 16,
    borderRadius: 6,
  },
  pool8FreeSideCounterAdjustText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 17,
  },
  pool8FreeSideCounterAdjustTextCompact: {
    fontSize: 12,
    lineHeight: 14,
  },
  pool8FreeSideCounterBody: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  pool8FreeSideCounterBodyCompact: {
    paddingVertical: 1,
  },
  pool8FreeSideCounterTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
    textAlign: 'center',
  },
  pool8FreeSideCounterTitleCompact: {
    fontSize: 8,
    marginBottom: 2,
  },
  pool8FreeSideCounterValue: {
    color: '#FF2525',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
  },
  pool8FreeSideCounterValueCompact: {
    fontSize: 17,
    lineHeight: 19,
  },
  pool8FreeCenterWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pool8FreeRowsWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pool8FreeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pool8FreeBallPlaceholder: {
    width: 44,
    height: 44,
  },
  pool8FreeWinnerInline: {
    width: '100%',
    minHeight: 148,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2C2F35',
    backgroundColor: '#17181C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  pool8FreeWinnerInlineText: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 14,
  },
  pool8FreeWinnerInlineButton: {
    minWidth: 164,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F1BE4C',
    backgroundColor: '#E2A20A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  pool8FreeWinnerInlineButtonText: {
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    textAlign: 'center',
  },
  });
};

export default memo(GameConsole);
