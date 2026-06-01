import React, {memo, useContext, useEffect, useMemo, useState} from 'react';
import {StyleSheet} from 'react-native';

import Container from 'components/Container';
import View from 'components/View';
import Text from 'components/Text';
import Button from 'components/Button';
import colors from 'configuration/colors';
import i18n from 'i18n';

import GamePlayViewModel from './GamePlayViewModel';
import GamePlayer from './player';
import GameConsole from './console';
import createStyles from './styles';
import TopMatchHeader from './TopMatchHeader';
import PoolShotClock from './PoolShotClock';
import {
  getCameraFullscreen,
  setCameraFullscreen,
  subscribeCameraFullscreen,
} from './cameraFullscreenStore';
import {
  isCaromGame,
  isPool15FreeGame,
  isPool15Game,
  isPool15OnlyGame,
  isPoolGame,
} from 'utils/game';
import useAdaptiveLayout, {AdaptiveLayout} from '../useAdaptiveLayout';
import useDesignSystem from 'theme/useDesignSystem';
import useScreenSystemUI, {configureSystemUI} from 'theme/systemUI';
import {createGameplayLayoutRules} from './layoutRules';
import {LanguageContext} from 'context/language';
import RemoteControl from 'utils/remote';

const buildTitle = (category?: string, mode?: string) => {
  return `${i18n.t(category || '').toUpperCase()} - ${i18n
    .t(mode || '')
    .toUpperCase()}`;
};


const formatHeaderTime = (totalTime?: number) => {
  const safeTotalTime = Number(totalTime || 0);
  const hours = Math.floor(safeTotalTime / 3600);
  const minutes = Math.floor((safeTotalTime % 3600) / 60);
  const seconds = Math.floor(safeTotalTime % 60);

  const pad = (value: number) => (value < 10 ? `0${value}` : `${value}`);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

const createLocalStyles = (a: AdaptiveLayout, design: any, rules: any) =>
  StyleSheet.create({
    splitColumn: {
      flex: 1,
      gap: rules.panelGap,
    },
    splitColumnCompact: {
      gap: design.spacing.xs,
    },
    splitSlot: {
      flex: 1,
      minHeight: 0,
    },
    topBottomBoard: {
      flex: 1,
      gap: rules.panelGap,
    },
    topBottomBoardCompact: {
      gap: design.spacing.xs,
    },
    topBottomRowTop: {
      flex: 1.12,
      gap: rules.panelGap,
    },
    topBottomRowBottom: {
      flex: 0.88,
      gap: rules.panelGap,
    },
    topBottomRowCompact: {
      gap: design.spacing.xs,
    },
    lightScreen: {
      backgroundColor: '#000000',
    },
    centerCompactCell: {
      flex: 1.02,
      minHeight: 0,
    },
    sideCompactCell: {
      flex: 1,
      minHeight: 0,
    },
    tabletPlayerSlot: {
      flex: rules.playerConsoleRatio.side,
      minWidth: 0,
    },
    tabletConsoleSlot: {
      flex: rules.playerConsoleRatio.center,
      minWidth: 0,
    },
    multiPlayerSideColumn: {
      flex: 1.06,
      minWidth: 0,
    },
    multiPlayerConsoleSlot: {
      flex: 0.96,
      minWidth: 0,
    },
    compactMainArea: {
      paddingHorizontal: a.s(6),
      paddingVertical: a.s(6),
      gap: design.spacing.xs,
    },
    hiddenFullscreenSlot: {
      display: 'none',
    },
    fullscreenConsoleSlot: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      width: '100%',
      height: '100%',
      minWidth: 0,
      minHeight: 0,
      alignSelf: 'stretch',
      alignItems: 'stretch',
      justifyContent: 'flex-start',
      zIndex: 260,
      elevation: 260,
    },
    fullscreenMainArea: {
      flex: 1,
      width: '100%',
      height: '100%',
      minWidth: 0,
      minHeight: 0,
      alignSelf: 'stretch',
      alignItems: 'stretch',
      justifyContent: 'flex-start',
      paddingHorizontal: 0,
      paddingVertical: 0,
      gap: 0,
      position: 'relative',
      overflow: 'hidden',
    },
    fullscreenFill: {
      flex: 1,
      width: '100%',
      height: '100%',
      minWidth: 0,
      minHeight: 0,
      alignSelf: 'stretch',
      alignItems: 'stretch',
      justifyContent: 'flex-start',
      backgroundColor: '#000000',
      overflow: 'hidden',
    },
    pool8SetOverlayBackdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 180,
      elevation: 30,
      backgroundColor: 'rgba(0, 0, 0, 0.72)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: a.s(20),
      paddingVertical: a.s(20),
    },
    pool8SetOverlayCard: {
      width: '100%',
      maxWidth: a.s(620),
      minWidth: a.s(320),
      borderRadius: a.s(28),
      borderWidth: 1.2,
      borderColor: 'rgba(255, 49, 49, 0.72)',
      backgroundColor: 'rgba(12, 13, 18, 0.98)',
      paddingHorizontal: a.s(32),
      paddingVertical: a.s(28),
      gap: design.spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#FF2D2D',
      shadowOpacity: 0.24,
      shadowRadius: a.s(18),
      shadowOffset: {width: 0, height: 0},
      elevation: 14,
    },
    pool8SetOverlayTitle: {
      textAlign: 'center',
      color: '#FFFFFF',
      fontSize: a.fs(44, 0.82, 1.04),
      lineHeight: a.fs(52, 0.82, 1.04),
      fontWeight: '700',
    },
    pool8SetOverlayButton: {
      alignSelf: 'center',
      minWidth: a.s(240),
      backgroundColor: '#E2A20A',
      borderColor: '#F1BE4C',
      borderRadius: a.s(18),
    },
    pool8SetOverlayButtonText: {
      color: '#FFFFFF',
      fontWeight: '700',
      textAlign: 'center',
    },
    caromWinnerOverlayBackdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 260,
      elevation: 48,
      backgroundColor: 'rgba(0, 0, 0, 0.76)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: a.s(24),
      paddingVertical: a.s(24),
    },
    caromWinnerOverlayCard: {
      width: '100%',
      maxWidth: a.s(980),
      borderRadius: a.s(28),
      borderWidth: 1.4,
      borderColor: 'rgba(255, 56, 56, 0.88)',
      backgroundColor: 'rgba(10, 10, 12, 0.98)',
      paddingHorizontal: a.s(26),
      paddingVertical: a.s(24),
      shadowColor: '#FF2D2D',
      shadowOpacity: 0.28,
      shadowRadius: a.s(24),
      shadowOffset: {width: 0, height: 0},
      elevation: 18,
    },
    caromWinnerOverlayHeader: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: a.s(24),
      width: '100%',
    },
    caromWinnerOverlayEyebrow: {
      color: '#FF5A5A',
      fontSize: a.fs(24, 0.98, 1.18),
      lineHeight: a.fs(30, 0.98, 1.18),
      fontWeight: '800',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginBottom: a.s(8),
    },
    caromWinnerOverlayTitle: {
      color: '#FFFFFF',
      fontSize: a.fs(52, 1.04, 1.26),
      lineHeight: a.fs(58, 1.04, 1.26),
      fontWeight: '900',
      textAlign: 'center',
    },
    caromWinnerOverlaySubtitle: {
      color: 'rgba(255, 255, 255, 0.92)',
      fontSize: a.fs(28, 0.96, 1.16),
      lineHeight: a.fs(34, 0.96, 1.16),
      fontWeight: '600',
      textAlign: 'center',
      marginTop: a.s(8),
    },
    caromWinnerScoreHeader: {
      flexDirection: 'row',
      alignItems: 'stretch',
      justifyContent: 'space-between',
      backgroundColor: '#B11616',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
      borderRadius: a.s(22),
      overflow: 'hidden',
      marginBottom: a.s(16),
      minHeight: a.s(72),
    },
    caromWinnerScoreCell: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: a.s(8),
      paddingVertical: a.s(10),
      borderRightWidth: 1,
      borderRightColor: 'rgba(255,255,255,0.12)',
    },
    caromWinnerScoreCellName: {
      flex: 2.1,
    },
    caromWinnerScoreCellNameLeft: {
      backgroundColor: '#FFFFFF',
    },
    caromWinnerScoreCellNameRight: {
      backgroundColor: '#F2C230',
    },
    caromWinnerScoreCellMatch: {
      flex: 0.9,
      backgroundColor: 'rgba(0, 0, 0, 0.18)',
    },
    caromWinnerScoreCellLast: {
      borderRightWidth: 0,
    },
    caromWinnerScoreNameText: {
      color: '#FFFFFF',
      fontSize: a.fs(30, 0.98, 1.18),
      lineHeight: a.fs(36, 0.98, 1.18),
      fontWeight: '900',
      textTransform: 'uppercase',
      textAlign: 'center',
    },
    caromWinnerScoreNameTextDark: {
      color: '#111111',
    },
    caromWinnerScoreValueText: {
      color: '#FFFFFF',
      fontSize: a.fs(38, 1.0, 1.2),
      lineHeight: a.fs(44, 1.0, 1.2),
      fontWeight: '900',
      textAlign: 'center',
    },
    caromWinnerStatsTable: {
      gap: a.s(10),
    },
    caromWinnerStatsRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: a.s(10),
    },
    caromWinnerStatsValueCell: {
      flex: 1,
      minHeight: a.s(76),
      borderRadius: a.s(18),
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.08)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: a.s(10),
      paddingVertical: a.s(12),
    },
    caromWinnerStatsLabelCell: {
      flex: 1.15,
      minHeight: a.s(76),
      borderRadius: a.s(18),
      backgroundColor: 'rgba(177, 22, 22, 0.22)',
      borderWidth: 1,
      borderColor: 'rgba(255, 90, 90, 0.28)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: a.s(10),
      paddingVertical: a.s(12),
    },
    caromWinnerStatsValueText: {
      color: '#FFFFFF',
      fontSize: a.fs(42, 1.02, 1.24),
      lineHeight: a.fs(48, 1.02, 1.24),
      fontWeight: '900',
      textAlign: 'center',
    },
    caromWinnerStatsLabelText: {
      color: '#FFFFFF',
      fontSize: a.fs(32, 1.0, 1.18),
      lineHeight: a.fs(38, 1.0, 1.18),
      fontWeight: '800',
      textAlign: 'center',
    },
    caromWinnerOverlayCloseButton: {
      marginTop: a.s(24),
      width: '100%',
      alignSelf: 'center',
      borderRadius: a.s(22),
      borderWidth: 1.2,
      borderColor: 'rgba(255, 68, 68, 0.82)',
      backgroundColor: '#1A0E0E',
      minHeight: a.s(76),
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: a.s(18),
      paddingVertical: a.s(14),
    },
    caromWinnerOverlayCloseText: {
      color: '#FFFFFF',
      fontSize: a.fs(34, 1.0, 1.2),
      lineHeight: a.fs(40, 1.0, 1.2),
      fontWeight: '900',
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    youtubeLiveOverlayBackdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 320,
      elevation: 60,
      backgroundColor: 'rgba(0, 0, 0, 0.78)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: a.s(24),
      paddingVertical: a.s(24),
    },
    youtubeLiveOverlayCard: {
      width: '100%',
      maxWidth: a.s(720),
      borderRadius: a.s(26),
      borderWidth: 1.4,
      borderColor: 'rgba(255, 49, 49, 0.78)',
      backgroundColor: 'rgba(10, 10, 12, 0.98)',
      paddingHorizontal: a.s(28),
      paddingVertical: a.s(26),
      shadowColor: '#FF174F',
      shadowOpacity: 0.28,
      shadowRadius: a.s(20),
      shadowOffset: {width: 0, height: 0},
      elevation: 18,
    },
    youtubeLiveOverlayTitle: {
      color: '#FFFFFF',
      fontSize: a.fs(34, 0.78, 1.04),
      lineHeight: a.fs(41, 0.78, 1.04),
      fontWeight: '900',
      textAlign: 'center',
    },
    youtubeLiveOverlayMessage: {
      color: '#FFFFFF',
      opacity: 0.9,
      fontSize: a.fs(18, 0.82, 1.04),
      lineHeight: a.fs(25, 0.82, 1.04),
      textAlign: 'center',
      marginTop: a.s(12),
      marginBottom: a.s(18),
    },
    youtubeLiveCheckList: {
      width: '100%',
      gap: a.s(12),
      marginTop: a.s(4),
    },
    youtubeLiveCheckRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: a.s(14),
      paddingVertical: a.s(12),
      borderRadius: a.s(16),
      backgroundColor: 'rgba(255, 255, 255, 0.06)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    youtubeLiveCheckDot: {
      width: a.s(14),
      height: a.s(14),
      borderRadius: a.s(7),
      marginTop: a.s(4),
      marginRight: a.s(12),
      backgroundColor: '#FF174F',
    },
    youtubeLiveCheckDotPass: {
      backgroundColor: '#14D36B',
    },
    youtubeLiveCheckDotUnknown: {
      backgroundColor: '#F3B233',
    },
    youtubeLiveCheckTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    youtubeLiveCheckLabel: {
      color: '#FFFFFF',
      fontSize: a.fs(17, 0.82, 1.04),
      lineHeight: a.fs(22, 0.82, 1.04),
      fontWeight: '800',
    },
    youtubeLiveCheckDetail: {
      color: '#D7D7D7',
      fontSize: a.fs(14, 0.82, 1.04),
      lineHeight: a.fs(20, 0.82, 1.04),
      marginTop: a.s(4),
    },
    youtubeLiveActionRow: {
      flexDirection: a.shortSide < 520 ? 'column' : 'row',
      gap: a.s(12),
      marginTop: a.s(22),
      width: '100%',
    },
    youtubeLivePrimaryButton: {
      flex: 1,
      backgroundColor: '#C91D24',
      borderColor: '#FF4D55',
      borderRadius: a.s(16),
      paddingHorizontal: a.s(18),
      paddingVertical: a.s(12),
      minHeight: a.s(50),
      alignItems: 'center',
      justifyContent: 'center',
    },
    youtubeLiveSecondaryButton: {
      flex: 1,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderColor: 'rgba(255,255,255,0.18)',
      borderRadius: a.s(16),
      paddingHorizontal: a.s(18),
      paddingVertical: a.s(12),
      minHeight: a.s(50),
      alignItems: 'center',
      justifyContent: 'center',
    },
    youtubeLiveButtonText: {
      color: '#FFFFFF',
      fontSize: a.fs(16, 0.82, 1.04),
      lineHeight: a.fs(20, 0.82, 1.04),
      fontWeight: '900',
      textAlign: 'center',
    },
  });

const GamePlay = () => {
  const {language} = useContext(LanguageContext);
  void language;
  const viewModel = GamePlayViewModel();
  useScreenSystemUI({variant: 'fullscreen', barStyle: 'light-content'});
  const {adaptive, design} = useDesignSystem();
  const layoutRules = useMemo(() => createGameplayLayoutRules(adaptive, design), [adaptive.styleKey]);
  const styles = useMemo(() => createStyles(adaptive, design, layoutRules), [adaptive.styleKey]);
  const localStyles = useMemo(
    () => createLocalStyles(adaptive, design, layoutRules),
    [adaptive.styleKey],
  );
  const [isCameraFullscreen, setIsCameraFullscreen] = useState(
    getCameraFullscreen(),
  );
  const [remoteEnabled, setRemoteEnabled] = useState(false);

  const onToggleRemote = (value: boolean) => {
    setRemoteEnabled(value);
    RemoteControl.instance.setEnabled?.(value);
  };

  useEffect(() => {
    return () => {
      RemoteControl.instance.setEnabled?.(false);
    };
  }, []);

  useEffect(() => {
    return subscribeCameraFullscreen(setIsCameraFullscreen);
  }, []);

  useEffect(() => {
    return () => {
      setCameraFullscreen(false);
    };
  }, []);

  useEffect(() => {
    if (!isCameraFullscreen) {
      return;
    }

    configureSystemUI({barStyle: 'light-content', backgroundColor: 'transparent', animated: false});
    const timers = [80, 220, 480].map(delay =>
      setTimeout(() => {
        configureSystemUI({barStyle: 'light-content', backgroundColor: 'transparent', animated: false});
      }, delay),
    );

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [isCameraFullscreen]);

  const isLargeDisplay = adaptive.layoutPreset === 'tv';
  const isWideTabletTwoPlayer =
    adaptive.isLandscape && adaptive.layoutPreset === 'wideTablet';
  const isCompactLandscape =
    adaptive.isLandscape &&
    (adaptive.breakpoint === 'compact' ||
      adaptive.width < 1440 ||
      adaptive.height <= 760 ||
      adaptive.widthClass === 'compact' ||
      (adaptive.width < 1920 && adaptive.aspectRatio >= 1.9));
  const useCompactTwoPlayerLayout =
    isCompactLandscape || adaptive.shortSide < 430 || adaptive.height <= 700;
  const useTightTwoPlayerLayout =
    useCompactTwoPlayerLayout || isWideTabletTwoPlayer;

  const category = viewModel.gameSettings?.category;
  const players = (viewModel.playerSettings?.playingPlayers || []).slice(0, 4);
  const configuredPlayerCount = Math.min(
    4,
    Number(viewModel.gameSettings?.players?.playerNumber || players.length || 2),
  );
  const totalPlayers = Math.min(4, Math.max(players.length, configuredPlayerCount, 2));

  const isPoolArenaLayout = useMemo(() => {
    return (
      isPoolGame(category) &&
      !isPool15FreeGame(category) &&
      totalPlayers === 2
    );
  }, [category, totalPlayers]);

  const useDarkPoolBackground = useMemo(() => {
    return isPoolGame(category);
  }, [category]);

  const isCaromMode = useMemo(() => isCaromGame(category), [category]);
  const useThreePlayerLayout = totalPlayers === 3;
  const useFourPlayerLayout = totalPlayers === 4;
  const useFivePlayerCaromLayout = false;
  const useMultiPlayerLayout =
    !isCameraFullscreen &&
    (useThreePlayerLayout || useFourPlayerLayout);
  const useCompactResponsiveLayout =
    useMultiPlayerLayout || (!isCameraFullscreen && useCompactTwoPlayerLayout);

  const responsivePlayerSlotStyle = isCameraFullscreen
    ? localStyles.hiddenFullscreenSlot
    : !isCameraFullscreen && useTightTwoPlayerLayout && !useMultiPlayerLayout
      ? localStyles.tabletPlayerSlot
      : undefined;

  const responsiveConsoleSlotStyle = isCameraFullscreen
    ? localStyles.fullscreenConsoleSlot
    : !isCameraFullscreen && useTightTwoPlayerLayout && !useMultiPlayerLayout
      ? localStyles.tabletConsoleSlot
      : undefined;

  const compactMainAreaStyle = isCameraFullscreen
    ? localStyles.fullscreenMainArea
    : !isCameraFullscreen && useTightTwoPlayerLayout
      ? localStyles.compactMainArea
      : undefined;

  const displayProModeEnabled =
    viewModel.proModeEnabled && !(isCaromMode && totalPlayers > 2);

  const pool8SetWinnerPlayer =
    isPool15OnlyGame(category) && viewModel.pool8SetWinnerIndex != null
      ? players[viewModel.pool8SetWinnerIndex]
      : undefined;

  const pool8FreeSetWinnerPlayer =
    isPool15FreeGame(category) && viewModel.pool8FreeSetWinnerIndex != null
      ? players[viewModel.pool8FreeSetWinnerIndex]
      : undefined;

  const showPool8SetOverlay =
    !viewModel.winner &&
    !viewModel.youtubeLiveOverlay?.visible &&
    !isCameraFullscreen &&
    Boolean(pool8SetWinnerPlayer || pool8FreeSetWinnerPlayer);

  const setWinnerOverlayPlayer = pool8SetWinnerPlayer || pool8FreeSetWinnerPlayer;

  const effectivePlayerSettings = useMemo(() => {
    if (!viewModel.playerSettings) {
      return viewModel.playerSettings;
    }

    return {
      ...viewModel.playerSettings,
      playerNumber: totalPlayers as any,
      playingPlayers: players,
    };
  }, [players, totalPlayers, viewModel.playerSettings]);

  const title = useMemo(() => {
    return buildTitle(
      viewModel.gameSettings?.category,
      viewModel.gameSettings?.mode?.mode,
    );
  }, [viewModel.gameSettings?.category, viewModel.gameSettings?.mode?.mode]);

  const headerTimeText = useMemo(() => {
    return formatHeaderTime(viewModel.totalTime);
  }, [viewModel.totalTime]);

  const usePoolHeaderClock = useMemo(() => {
    return isPoolGame(category) && !isPool15FreeGame(category);
  }, [category]);

  const warmTitleSize = adaptive.fs(isLargeDisplay ? 64 : 52, 0.8, 1.06);
  const warmTimerSize = adaptive.fs(isLargeDisplay ? 256 : 190, 0.74, 1.05);
  const warmTimerLineHeight = Math.round(warmTimerSize * 1.03);
  const warmButtonTextSize = adaptive.fs(isLargeDisplay ? 32 : 24, 0.82, 1.04);

  const pauseOverlayButtonStyle = {
    minWidth: isLargeDisplay ? adaptive.s(360) : adaptive.s(230),
    alignItems: 'center' as const,
    paddingHorizontal: adaptive.s(isLargeDisplay ? 36 : 22),
    paddingVertical: adaptive.s(isLargeDisplay ? 15 : 10),
  };

  const showCaromWinnerOverlay =
    isCaromGame(category) &&
    totalPlayers === 2 &&
    viewModel.gameSettings?.mode?.mode === 'pro' &&
    displayProModeEnabled &&
    !!viewModel.winner &&
    !viewModel.youtubeLiveOverlay?.visible;

  const formatWinnerStatNumber = (value?: number, digits = 0) => {
    const numeric = Number(value ?? 0);

    if (!Number.isFinite(numeric)) {
      return digits > 0 ? `0.${'0'.repeat(digits)}` : '0';
    }

    if (digits > 0) {
      return numeric
        .toFixed(digits)
        .replace(/\.0+$/, '')
        .replace(/(\.\d*?)0+$/, '$1');
    }

    return `${Math.round(numeric)}`;
  };

  const winnerSummaryPlayers = (effectivePlayerSettings?.playingPlayers || []).slice(0, 2);
  const leftWinnerSummaryPlayer = winnerSummaryPlayers[0];
  const rightWinnerSummaryPlayer = winnerSummaryPlayers[1];

  const winnerSummaryRows = [
    {
      label: 'Average',
      left: formatWinnerStatNumber(leftWinnerSummaryPlayer?.proMode?.average, 2),
      right: formatWinnerStatNumber(rightWinnerSummaryPlayer?.proMode?.average, 2),
    },
    {
      label: 'High Run 1',
      left: formatWinnerStatNumber(leftWinnerSummaryPlayer?.proMode?.highestRate),
      right: formatWinnerStatNumber(rightWinnerSummaryPlayer?.proMode?.highestRate),
    },
    {
      label: 'High Run 2',
      left: formatWinnerStatNumber(leftWinnerSummaryPlayer?.proMode?.secondHighestRate),
      right: formatWinnerStatNumber(rightWinnerSummaryPlayer?.proMode?.secondHighestRate),
    },
  ];

  if (
    !viewModel.gameSettings ||
    viewModel.updateGameSettings.isLoading ||
    !viewModel.playerSettings
  ) {
    return (
      <Container variant="fullscreen" isLoading={true}>
        <View />
      </Container>
    );
  }

  const showPauseOverlay =
    viewModel.isPaused &&
    !viewModel.warmUpCountdownTime &&
    !isCameraFullscreen &&
    !viewModel.winner &&
    !showPool8SetOverlay &&
    !viewModel.youtubeLiveOverlay?.visible;

  const renderPlayer = (playerIndex: number) => {
    const player = players[playerIndex];
    if (!player) {
      return <View style={localStyles.splitSlot} />;
    }

    return (
      <GamePlayer
        layout={'poolArena'}
        compact={useCompactResponsiveLayout}
        index={playerIndex}
        isOnTurn={viewModel.currentPlayerIndex === playerIndex}
        isOnPoolBreak={viewModel.poolBreakPlayerIndex === playerIndex}
        isStarted={viewModel.isStarted}
        isPaused={viewModel.isPaused}
        soundEnabled={viewModel.soundEnabled}
        proModeEnabled={displayProModeEnabled}
        totalTurns={viewModel.totalTurns}
        gameSettings={viewModel.gameSettings}
        totalPlayers={totalPlayers}
        player={player}
        onSwitchPoolBreakPlayerIndex={viewModel.onSwitchPoolBreakPlayerIndex}
        onEditPlayerName={viewModel.onEditPlayerName}
        onChangePlayerPoint={viewModel.onChangePlayerPoint}
        onViolate={viewModel.onViolate}
        onEndTurn={viewModel.onEndTurn}
        onPressGiveMoreTime={viewModel.onPressGiveMoreTime}
        showPool8Tracker={isPool15OnlyGame(category) && viewModel.isStarted && !viewModel.poolBreakEnabled}
        pool8Tracker={viewModel.pool8Trackers?.[playerIndex]}
        onPressPool8Ball={viewModel.onPressPool8Ball}
      />
    );
  };

  const renderConsole = () => {
    return (
      <GameConsole
        winner={viewModel.winner}
        gameSettings={viewModel.gameSettings}
        playerSettings={effectivePlayerSettings}
        currentMode={viewModel.gameSettings.mode}
        warmUpCount={viewModel.warmUpCount}
        warmUpCountdownTime={viewModel.warmUpCountdownTime}
        gameBreakEnabled={viewModel.gameBreakEnabled}
        totalPlayers={totalPlayers}
        totalTime={viewModel.totalTime}
        totalTurns={viewModel.totalTurns}
        goal={viewModel.gameSettings?.players?.goal?.goal}
        countdownTime={viewModel.countdownTime}
        currentPlayerIndex={viewModel.currentPlayerIndex}
        isStarted={viewModel.isStarted}
        isPaused={viewModel.isPaused}
        isMatchPaused={viewModel.isMatchPaused}
        soundEnabled={viewModel.soundEnabled}
        poolBreakEnabled={viewModel.poolBreakEnabled}
        proModeEnabled={displayProModeEnabled}
        webcamFolderName={viewModel.webcamFolderName}
        onGameBreak={viewModel.onGameBreak}
        onPoolBreak={viewModel.onPoolBreak}
        onPressGiveMoreTime={viewModel.onPressGiveMoreTime}
        onWarmUp={viewModel.onWarmUp}
        onSwitchTurn={viewModel.onSwitchTurn}
        onSwapPlayers={viewModel.onSwapPlayers}
        onIncreaseTotalTurns={viewModel.onIncreaseTotalTurns}
        onDecreaseTotalTurns={viewModel.onDecreaseTotalTurns}
        onToggleSound={viewModel.onToggleSound}
        onToggleProMode={viewModel.onToggleProMode}
        onPool15OnlyScore={viewModel.onPool15OnlyScore}
        onPoolScore={viewModel.onPoolScore}
        pool8Trackers={viewModel.pool8Trackers}
        pool8SetWinnerIndex={viewModel.pool8SetWinnerIndex}
        onSwapPool8Groups={viewModel.onSwapPool8Groups}
        pool8FreeHole10Scores={viewModel.pool8FreeHole10Scores}
        pool8FreeSetWinnerIndex={viewModel.pool8FreeSetWinnerIndex}
        onIncrementPool8FreeHole10={viewModel.onIncrementPool8FreeHole10}
        onDecrementPool8FreeHole10={viewModel.onDecrementPool8FreeHole10}
        renderLastPlayer={() => <View />}
        onSelectWinner={viewModel.onSelectWinner}
        onClearWinner={viewModel.onClearWinner}
        onStart={viewModel.onStart}
        onPause={viewModel.onPause}
        onStop={viewModel.onStop}
        onReset={viewModel.onReset}
        onResetTurn={viewModel.onResetTurn}
        updateWebcamFolderName={viewModel.updateWebcamFolderName}
        cameraRef={viewModel.cameraRef}
        isCameraReady={viewModel.isCameraReady}
        setIsCameraReady={viewModel.setIsCameraReady}
        youtubeLivePreviewActive={viewModel.youtubeLivePreviewActive}
        cameraFullscreen={isCameraFullscreen}
      />
    );
  };

  const renderMainBoard = () => {
    if (useFivePlayerCaromLayout) {
      return (
        <View
          flex={'1'}
          style={[
            styles.poolArenaBoard,
            styles.mainArea,
            localStyles.topBottomBoard,
            useCompactResponsiveLayout && localStyles.topBottomBoardCompact,
            compactMainAreaStyle,
          ]}>
          <View
            direction={'row'}
            style={[
              localStyles.topBottomRowTop,
              useCompactResponsiveLayout && localStyles.topBottomRowCompact,
            ]}>
            <View
              style={[localStyles.sideCompactCell, responsivePlayerSlotStyle]}>
              {renderPlayer(0)}
            </View>
            <View
              style={[
                localStyles.centerCompactCell,
                responsiveConsoleSlotStyle,
              ]}>
              {renderConsole()}
            </View>
            <View
              style={[localStyles.sideCompactCell, responsivePlayerSlotStyle]}>
              {renderPlayer(1)}
            </View>
          </View>

          <View
            direction={'row'}
            style={[
              localStyles.topBottomRowBottom,
              useCompactResponsiveLayout && localStyles.topBottomRowCompact,
            ]}>
            <View
              style={[localStyles.sideCompactCell, responsivePlayerSlotStyle]}>
              {renderPlayer(2)}
            </View>
            <View
              style={[localStyles.centerCompactCell, responsivePlayerSlotStyle]}>
              {renderPlayer(4)}
            </View>
            <View
              style={[localStyles.sideCompactCell, responsivePlayerSlotStyle]}>
              {renderPlayer(3)}
            </View>
          </View>
        </View>
      );
    }

    if (useThreePlayerLayout) {
      return (
        <View
          flex={'1'}
          direction={'row'}
          style={[styles.poolArenaBoard, styles.mainArea, compactMainAreaStyle]}>
          <View
            style={[
              styles.poolArenaPlayerColumn,
              localStyles.multiPlayerSideColumn,
              responsivePlayerSlotStyle,
            ]}>
            {renderPlayer(0)}
          </View>

          <View
            style={[
              styles.poolArenaConsoleWrapper,
              localStyles.multiPlayerConsoleSlot,
              responsiveConsoleSlotStyle,
            ]}>
            {renderConsole()}
          </View>

          <View
            style={[
              localStyles.splitColumn,
              localStyles.multiPlayerSideColumn,
              useCompactResponsiveLayout && localStyles.splitColumnCompact,
              responsivePlayerSlotStyle,
            ]}>
            <View style={localStyles.splitSlot}>{renderPlayer(1)}</View>
            <View style={localStyles.splitSlot}>{renderPlayer(2)}</View>
          </View>
        </View>
      );
    }

    if (useFourPlayerLayout) {
      return (
        <View
          flex={'1'}
          direction={'row'}
          style={[styles.poolArenaBoard, styles.mainArea, compactMainAreaStyle]}>
          <View
            style={[
              localStyles.splitColumn,
              localStyles.multiPlayerSideColumn,
              useCompactResponsiveLayout && localStyles.splitColumnCompact,
              responsivePlayerSlotStyle,
            ]}>
            <View style={localStyles.splitSlot}>{renderPlayer(0)}</View>
            <View style={localStyles.splitSlot}>{renderPlayer(2)}</View>
          </View>

          <View
            style={[
              styles.poolArenaConsoleWrapper,
              localStyles.multiPlayerConsoleSlot,
              responsiveConsoleSlotStyle,
            ]}>
            {renderConsole()}
          </View>

          <View
            style={[
              localStyles.splitColumn,
              localStyles.multiPlayerSideColumn,
              useCompactResponsiveLayout && localStyles.splitColumnCompact,
              responsivePlayerSlotStyle,
            ]}>
            <View style={localStyles.splitSlot}>{renderPlayer(1)}</View>
            <View style={localStyles.splitSlot}>{renderPlayer(3)}</View>
          </View>
        </View>
      );
    }


    return (
      <View
        flex={'1'}
        direction={'row'}
        style={[styles.poolArenaBoard, styles.mainArea, compactMainAreaStyle]}>
        <View style={[styles.poolArenaPlayerColumn, responsivePlayerSlotStyle]}>
          {renderPlayer(0)}
        </View>
        <View
          style={[styles.poolArenaConsoleWrapper, responsiveConsoleSlotStyle]}>
          {renderConsole()}
        </View>
        <View style={[styles.poolArenaPlayerColumn, responsivePlayerSlotStyle]}>
          {renderPlayer(1)}
        </View>
      </View>
    );
  };


  const renderYouTubeLiveOverlay = () => {
    const overlay = viewModel.youtubeLiveOverlay;

    if (!overlay?.visible) {
      return null;
    }

    const checks = overlay.checks || [];

    return (
      <View style={localStyles.youtubeLiveOverlayBackdrop}>
        <View style={localStyles.youtubeLiveOverlayCard}>
          <Text
            color={colors.white}
            style={localStyles.youtubeLiveOverlayTitle}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}>
            {overlay.title || i18n.t('youtubeLiveEligibilityTitle')}
          </Text>

          <Text
            color={colors.white}
            style={localStyles.youtubeLiveOverlayMessage}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}>
            {overlay.message || i18n.t('youtubeLiveEligibilityShortMessage')}
          </Text>

          {checks.length > 0 ? (
            <View style={localStyles.youtubeLiveCheckList}>
              {checks.map((check, index) => {
                const dotStyle =
                  check.status === 'pass'
                    ? localStyles.youtubeLiveCheckDotPass
                    : check.status === 'unknown'
                      ? localStyles.youtubeLiveCheckDotUnknown
                      : undefined;

                return (
                  <View
                    key={String(check.key || index)}
                    style={localStyles.youtubeLiveCheckRow}>
                    <View style={[localStyles.youtubeLiveCheckDot, dotStyle]} />
                    <View style={localStyles.youtubeLiveCheckTextWrap}>
                      <Text
                        color={colors.white}
                        style={localStyles.youtubeLiveCheckLabel}
                        allowFontScaling={false}
                        maxFontSizeMultiplier={1}>
                        {check.label}
                      </Text>
                      <Text
                        color={'#D7D7D7'}
                        style={localStyles.youtubeLiveCheckDetail}
                        allowFontScaling={false}
                        maxFontSizeMultiplier={1}>
                        {check.detail}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={localStyles.youtubeLiveActionRow}>
            <Button
              style={localStyles.youtubeLivePrimaryButton}
              onPress={viewModel.openYouTubeLiveLogin}>
              <Text
                color={colors.white}
                style={localStyles.youtubeLiveButtonText}
                allowFontScaling={false}
                maxFontSizeMultiplier={1}>
                {i18n.t('youtubeLiveBackToSetup')}
              </Text>
            </Button>

            <Button
              style={localStyles.youtubeLiveSecondaryButton}
              onPress={viewModel.dismissYouTubeLiveOverlay}>
              <Text
                color={colors.white}
                style={localStyles.youtubeLiveButtonText}
                allowFontScaling={false}
                maxFontSizeMultiplier={1}>
                {i18n.t('txtClose')}
              </Text>
            </Button>
          </View>
        </View>
      </View>
    );
  };

  const WARM_UP_VIEW = !viewModel.warmUpCountdownTime || isCameraFullscreen ? (
    <View />
  ) : (
    <View style={styles.warmUpContainer}>
      <Text color={colors.white} fontSize={warmTitleSize}>
        {viewModel.gameBreakEnabled ? i18n.t('gameBreak') : i18n.t('warmUp')}
      </Text>

      <View marginVertical={isLargeDisplay ? '15' : '8'}>
        <Text
          color={colors.white}
          fontSize={warmTimerSize}
          lineHeight={warmTimerLineHeight}>
          {viewModel.getWarmUpTimeString()}
        </Text>
      </View>

      <Button
        style={[
          styles.buttonEndWarmUp,
          {
            paddingHorizontal: adaptive.s(isLargeDisplay ? 36 : 22),
            paddingVertical: adaptive.s(isLargeDisplay ? 15 : 10),
            marginTop: adaptive.s(isLargeDisplay ? 30 : 18),
          },
        ]}
        onPress={viewModel.onEndWarmUp}>
        <Text color={colors.white} fontSize={warmButtonTextSize}>
          {viewModel.gameBreakEnabled
            ? i18n.t('txtEndBreak')
            : i18n.t('txtEndWarmUp')}
        </Text>
      </Button>
    </View>
  );

  return (
    <Container variant="fullscreen" safeAreaDisabled={isCameraFullscreen}>
      <View
        style={[
          isCameraFullscreen ? styles.fullscreenScreen : useDarkPoolBackground ? styles.poolArenaScreen : undefined,
          isCameraFullscreen ? localStyles.fullscreenFill : undefined,
          !isCameraFullscreen && isCaromMode ? localStyles.lightScreen : undefined,
        ]}
        flex={'1'}>
        {!isCameraFullscreen ? (
          <>
            <TopMatchHeader
              title={title}
              soundEnabled={viewModel.soundEnabled}
              onToggleSound={viewModel.onToggleSound}
              remoteEnabled={remoteEnabled}
              onToggleRemote={onToggleRemote}
              proModeEnabled={displayProModeEnabled}
              onToggleProMode={viewModel.onToggleProMode}
              gameSettings={viewModel.gameSettings}
              totalPlayers={totalPlayers}
              centerTimeText={headerTimeText}
              compactTitleLeft={true}
            />
          </>
        ) : null}

        <View flex={'1'} style={isCameraFullscreen ? localStyles.fullscreenFill : undefined}>
          {renderMainBoard()}
        </View>

        {!isCameraFullscreen &&
        (isPoolGame(category) || isCaromGame(category)) &&
        viewModel.gameSettings?.mode?.mode !== 'fast' &&
        viewModel.gameSettings?.mode?.countdownTime ? (
          <View
            ref={viewModel.matchCountdownRef}
            collapsable={false}
            style={styles.countdownContainer}>
            <PoolShotClock
              originalCountdownTime={
                viewModel.gameSettings?.mode?.countdownTime || 40
              }
              currentCountdownTime={viewModel.countdownTime || 0}
              onPress={viewModel.onToggleCountDown}
            />
          </View>
        ) : null}


        {showPool8SetOverlay && setWinnerOverlayPlayer ? (
          <View style={localStyles.pool8SetOverlayBackdrop}>
            <View style={localStyles.pool8SetOverlayCard}>
              <Text
                style={localStyles.pool8SetOverlayTitle}
                color={colors.white}
                allowFontScaling={false}
                maxFontSizeMultiplier={1}>
                {`${setWinnerOverlayPlayer.name} ${i18n.t('txtSetWonSuffix')}`}
              </Text>

              <Button
                style={[pauseOverlayButtonStyle, localStyles.pool8SetOverlayButton]}
                onPress={viewModel.onReset}>
                <Text
                  style={[{fontSize: warmButtonTextSize}, localStyles.pool8SetOverlayButtonText]}
                  color={colors.white}
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}>
                  {i18n.t('txtNewRack')}
                </Text>
              </Button>
            </View>
          </View>
        ) : null}

        {showPauseOverlay ? (
          <View style={styles.warmUpContainer}>
            <Text color={colors.white} fontSize={warmTitleSize}>
              {i18n.t('pause')}
            </Text>

            <Button
              style={[
                styles.buttonEndWarmUp,
                pauseOverlayButtonStyle,
                {
                  marginTop: adaptive.s(isLargeDisplay ? 30 : 18),
                },
              ]}
              onPress={viewModel.onPause}>
              <Text color={colors.white} fontSize={warmButtonTextSize}>
                {i18n.t('resume')}
              </Text>
            </Button>

            <Button
              style={[
                styles.buttonEndWarmUp,
                pauseOverlayButtonStyle,
                {
                  marginTop: adaptive.s(isLargeDisplay ? 18 : 12),
                },
              ]}
              onPress={viewModel.onReplay}>
              <Text color={colors.white} fontSize={warmButtonTextSize}>
                {i18n.t('reWatch')}
              </Text>
            </Button>
          </View>
        ) : null}

        {showCaromWinnerOverlay ? (
          <View style={localStyles.caromWinnerOverlayBackdrop}>
            <View style={localStyles.caromWinnerOverlayCard}>
              <View style={localStyles.caromWinnerOverlayHeader}>
                <Text
                  style={localStyles.caromWinnerOverlayEyebrow}
                  color={'#FF5A5A'}
                  textAlign={'center'}
                  fontWeight={'900'}
                  fontSize={30}
                  lineHeight={36}
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}>
                  THỐNG KÊ TRẬN ĐẤU
                </Text>
                <Text
                  style={localStyles.caromWinnerOverlayTitle}
                  color={colors.white}
                  textAlign={'center'}
                  fontWeight={'900'}
                  fontSize={64}
                  lineHeight={72}
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}>
                  {viewModel.winner?.name || ''}
                </Text>
                <Text
                  style={localStyles.caromWinnerOverlaySubtitle}
                  color={colors.white}
                  textAlign={'center'}
                  fontWeight={'700'}
                  fontSize={34}
                  lineHeight={40}
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}>
                  Chúc mừng người chiến thắng
                </Text>
              </View>

              <View style={localStyles.caromWinnerScoreHeader}>
                <View
                  style={[
                    localStyles.caromWinnerScoreCell,
                    localStyles.caromWinnerScoreCellName,
                    localStyles.caromWinnerScoreCellNameLeft,
                  ]}>
                  <Text
                    style={[
                      localStyles.caromWinnerScoreNameText,
                      localStyles.caromWinnerScoreNameTextDark,
                    ]}
                    color={'#111111'}
                    textAlign={'center'}
                    fontWeight={'900'}
                    fontSize={48}
                    lineHeight={56}
                    allowFontScaling={false}
                    maxFontSizeMultiplier={1}>
                    {leftWinnerSummaryPlayer?.name || ''}
                  </Text>
                </View>
                <View style={localStyles.caromWinnerScoreCell}>
                  <Text
                    style={localStyles.caromWinnerScoreValueText}
                    color={colors.white}
                    textAlign={'center'}
                    fontWeight={'900'}
                    fontSize={62}
                    lineHeight={70}
                    allowFontScaling={false}
                    maxFontSizeMultiplier={1}>
                    {formatWinnerStatNumber(leftWinnerSummaryPlayer?.totalPoint)}
                  </Text>
                </View>
                <View style={[localStyles.caromWinnerScoreCell, localStyles.caromWinnerScoreCellMatch]}>
                  <Text
                    style={localStyles.caromWinnerScoreValueText}
                    color={colors.white}
                    textAlign={'center'}
                    fontWeight={'900'}
                    allowFontScaling={false}
                    maxFontSizeMultiplier={1}>
                    {' '}
                  </Text>
                </View>
                <View style={localStyles.caromWinnerScoreCell}>
                  <Text
                    style={localStyles.caromWinnerScoreValueText}
                    color={colors.white}
                    textAlign={'center'}
                    fontWeight={'900'}
                    fontSize={62}
                    lineHeight={70}
                    allowFontScaling={false}
                    maxFontSizeMultiplier={1}>
                    {formatWinnerStatNumber(rightWinnerSummaryPlayer?.totalPoint)}
                  </Text>
                </View>
                <View
                  style={[
                    localStyles.caromWinnerScoreCell,
                    localStyles.caromWinnerScoreCellName,
                    localStyles.caromWinnerScoreCellNameRight,
                    localStyles.caromWinnerScoreCellLast,
                  ]}>
                  <Text
                    style={[
                      localStyles.caromWinnerScoreNameText,
                      localStyles.caromWinnerScoreNameTextDark,
                    ]}
                    color={'#111111'}
                    textAlign={'center'}
                    fontWeight={'900'}
                    fontSize={48}
                    lineHeight={56}
                    allowFontScaling={false}
                    maxFontSizeMultiplier={1}>
                    {rightWinnerSummaryPlayer?.name || ''}
                  </Text>
                </View>
              </View>

              <View style={localStyles.caromWinnerStatsTable}>
                {winnerSummaryRows.map(row => (
                  <View key={row.label} style={localStyles.caromWinnerStatsRow}>
                    <View style={localStyles.caromWinnerStatsValueCell}>
                      <Text
                        style={localStyles.caromWinnerStatsValueText}
                        color={colors.white}
                        textAlign={'center'}
                        fontWeight={'900'}
                        fontSize={58}
                        lineHeight={66}
                        allowFontScaling={false}
                        maxFontSizeMultiplier={1}>
                        {row.left}
                      </Text>
                    </View>
                    <View style={localStyles.caromWinnerStatsLabelCell}>
                      <Text
                        style={localStyles.caromWinnerStatsLabelText}
                        color={colors.white}
                        textAlign={'center'}
                        fontWeight={'900'}
                        fontSize={44}
                        lineHeight={52}
                        allowFontScaling={false}
                        maxFontSizeMultiplier={1}>
                        {row.label}
                      </Text>
                    </View>
                    <View style={localStyles.caromWinnerStatsValueCell}>
                      <Text
                        style={localStyles.caromWinnerStatsValueText}
                        color={colors.white}
                        textAlign={'center'}
                        fontWeight={'900'}
                        fontSize={58}
                        lineHeight={66}
                        allowFontScaling={false}
                        maxFontSizeMultiplier={1}>
                        {row.right}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              <Button
                style={localStyles.caromWinnerOverlayCloseButton}
                onPress={viewModel.onCloseWinnerSummary}>
                <Text
                  style={localStyles.caromWinnerOverlayCloseText}
                  color={colors.white}
                  textAlign={'center'}
                  fontWeight={'900'}
                  fontSize={42}
                  lineHeight={50}
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1}>
                  XIN CHÚC MỪNG{`
`}TRẬN ĐẤU ĐÃ KẾT THÚC
                </Text>
              </Button>
            </View>
          </View>
        ) : null}

        {WARM_UP_VIEW}

        {renderYouTubeLiveOverlay()}
      </View>
    </Container>
  );
};

export default memo(GamePlay);
