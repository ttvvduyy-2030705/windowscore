import {StyleSheet} from 'react-native';

import colors from 'configuration/colors';
import {LayoutPreset} from 'scenes/game/useAdaptiveLayout';

const panelGapByPreset: Record<LayoutPreset, number> = {
  phone: 10,
  tablet: 12,
  wideTablet: 14,
  tv: 16,
};

const panelRadiusByPreset: Record<LayoutPreset, number> = {
  phone: 18,
  tablet: 20,
  wideTablet: 22,
  tv: 24,
};

export const createStyles = (adaptive: {
  s: (value: number) => number;
  fs: (value: number) => number;
  isLandscape: boolean;
  layoutPreset: LayoutPreset;
  aspectRatio: number;
  width?: number;
  height?: number;
  isShortLandscape?: boolean;
}) => {
  const {s, fs, isLandscape, layoutPreset, aspectRatio, width = 0, height = 0, isShortLandscape = false} = adaptive;
  const isPhone = layoutPreset === 'phone';
  const isWide = layoutPreset === 'wideTablet' || layoutPreset === 'tv';
  const compactLandscape = isLandscape && (isShortLandscape || height <= 760 || width <= 1180);
  const panelGap = s(compactLandscape ? Math.max(8, panelGapByPreset[layoutPreset] - 2) : panelGapByPreset[layoutPreset]);
  const panelRadius = s(compactLandscape ? Math.max(16, panelRadiusByPreset[layoutPreset] - 2) : panelRadiusByPreset[layoutPreset]);
  const titlePad = compactLandscape ? s(118) : isWide ? s(170) : s(148);
  const contentDirection = isLandscape ? 'row' : 'column';
  const panelSplit =
    isLandscape && aspectRatio >= 1.75
      ? {left: 0.94, right: 1.06}
      : isLandscape && aspectRatio >= 1.45
      ? {left: 0.97, right: 1.03}
      : {left: 1, right: 1};

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: '#000000',
      paddingHorizontal: s(isPhone ? 8 : compactLandscape ? 10 : 14),
      paddingTop: s(isPhone ? 6 : compactLandscape ? 8 : 10),
      paddingBottom: s(isPhone ? 6 : compactLandscape ? 8 : 10),
    },
    headerGlow: {
      position: 'relative',
      minHeight: s(isPhone ? 46 : compactLandscape ? 52 : 58),
      borderRadius: s(22),
      borderWidth: 1.1,
      borderColor: 'rgba(255, 52, 52, 0.24)',
      backgroundColor: '#050505',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: s(14),
      shadowColor: '#FF1414',
      shadowOpacity: 0.3,
      shadowRadius: s(14),
      shadowOffset: {width: 0, height: 4},
      elevation: 8,
    },
    headerBackButton: {
      position: 'absolute',
      left: s(12),
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      zIndex: 2,
    },
    headerBackFrame: {
      height: s(isPhone ? 38 : 42),
      minWidth: s(isPhone ? 96 : 110),
      paddingHorizontal: s(14),
      borderRadius: s(14),
      borderWidth: 1.1,
      borderColor: 'rgba(255, 52, 52, 0.24)',
      backgroundColor: '#070707',
      justifyContent: 'center',
      shadowColor: '#FF1414',
      shadowOpacity: 0.16,
      shadowRadius: s(9),
      shadowOffset: {width: 0, height: 3},
      elevation: 6,
      transform: [{skewX: '-16deg'}],
    },
    headerBackInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      transform: [{skewX: '16deg'}],
    },
    headerBackLogoImage: {
      width: s(isPhone ? 66 : 74),
      height: s(isPhone ? 22 : 26),
    },
    headerTitleWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: titlePad,
      pointerEvents: 'none',
    },
    headerTitle: {
      flexShrink: 1,
      color: '#FFFFFF',
      textAlign: 'center',
      fontSize: fs(isPhone ? 18 : 24),
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    contentRow: {
      flex: 1,
      width: '100%',
      alignSelf: 'stretch',
      flexDirection: contentDirection,
      marginTop: s(isPhone ? 8 : compactLandscape ? 10 : 12),
      minHeight: 0,
    },
    panelShell: {
      width: '100%',
      alignSelf: 'stretch',
      minHeight: 0,
      borderRadius: panelRadius,
      borderWidth: 1,
      borderColor: 'rgba(255, 42, 42, 0.18)',
      backgroundColor: '#050505',
      paddingTop: s(isPhone ? 6 : compactLandscape ? 8 : 10),
      paddingHorizontal: s(isPhone ? 6 : compactLandscape ? 8 : 10),
      paddingBottom: s(isPhone ? 5 : compactLandscape ? 6 : 8),
      shadowColor: '#FF1414',
      shadowOpacity: 0.18,
      shadowRadius: s(12),
      shadowOffset: {width: 0, height: 4},
      elevation: 7,
    },
    leftPanel: {
      flex: panelSplit.left,
      marginRight: isLandscape ? panelGap / 2 : 0,
      marginBottom: isLandscape ? 0 : panelGap,
    },
    rightPanel: {
      flex: panelSplit.right,
      marginLeft: isLandscape ? panelGap / 2 : 0,
    },
    panelHeader: {
      borderBottomWidth: 1.1,
      borderBottomColor: '#FF1F26',
      paddingBottom: s(isPhone ? 6 : 7),
      marginBottom: s(isPhone ? 6 : 8),
    },
    panelHeaderText: {
      alignSelf: 'flex-start',
      color: '#FFFFFF',
      fontSize: fs(isPhone ? 14 : 18),
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    panelScroll: {
      flex: 1,
      minHeight: 0,
    },
    panelScrollContent: {
      width: '100%',
      alignSelf: 'stretch',
      paddingBottom: s(4),
      flexGrow: 1,
    },
    rightPanelContent: {
      flex: 1,
      width: '100%',
      alignSelf: 'stretch',
      minHeight: 0,
    },
    playerScrollContent: {
      width: '100%',
      alignSelf: 'stretch',
      paddingBottom: s(6),
      flexGrow: 1,
    },
    aplusLivePanel: {
      width: '100%',
      alignSelf: 'stretch',
      borderRadius: s(15),
      borderWidth: 1,
      borderColor: 'rgba(255, 42, 42, 0.38)',
      backgroundColor: '#0A0A0A',
      paddingHorizontal: s(isPhone ? 8 : 10),
      paddingVertical: s(isPhone ? 8 : 10),
      marginBottom: s(10),
    },
    aplusLiveHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: s(8),
    },
    aplusLiveTitle: {
      color: '#FFFFFF',
      fontSize: fs(isPhone ? 12.5 : 15),
      fontWeight: '900',
    },
    aplusLiveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: s(8),
    },
    aplusMiniButton: {
      width: s(isPhone ? 30 : 34),
      height: s(isPhone ? 34 : 38),
      borderRadius: s(10),
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.3)',
      backgroundColor: '#171717',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: s(6),
    },
    aplusMiniButtonText: {
      color: '#FFFFFF',
      fontSize: fs(isPhone ? 18 : 22),
      fontWeight: '900',
      marginTop: -2,
    },
    aplusTournamentBox: {
      flex: 1,
      minWidth: 0,
      borderRadius: s(11),
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
      backgroundColor: '#111111',
      paddingHorizontal: s(10),
      paddingVertical: s(6),
      marginRight: s(6),
    },
    aplusTournamentLabel: {
      color: 'rgba(255,255,255,0.58)',
      fontSize: fs(isPhone ? 9 : 10.5),
      fontWeight: '700',
      marginBottom: s(2),
    },
    aplusTournamentName: {
      color: '#FFFFFF',
      fontSize: fs(isPhone ? 11.5 : 13.5),
      fontWeight: '900',
    },
    aplusReloadButton: {
      minWidth: s(isPhone ? 62 : 72),
      height: s(isPhone ? 34 : 38),
      borderRadius: s(10),
      backgroundColor: '#2B2B2B',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.2)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: s(8),
    },
    aplusReloadText: {
      color: '#FFFFFF',
      fontSize: fs(isPhone ? 10.5 : 12),
      fontWeight: '800',
    },
    aplusMatchInput: {
      flex: 1,
      height: s(isPhone ? 38 : 42),
      borderRadius: s(12),
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.18)',
      backgroundColor: '#111111',
      color: '#FFFFFF',
      fontSize: fs(isPhone ? 14 : 16),
      fontWeight: '900',
      paddingHorizontal: s(12),
      marginRight: s(8),
    },
    aplusLoadMatchButton: {
      minWidth: s(isPhone ? 82 : 96),
      height: s(isPhone ? 38 : 42),
      borderRadius: s(12),
      backgroundColor: '#D61F26',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: s(10),
    },
    aplusLoadMatchText: {
      color: '#FFFFFF',
      fontSize: fs(isPhone ? 11.5 : 13),
      fontWeight: '900',
    },
    aplusLiveStatus: {
      color: 'rgba(255,255,255,0.78)',
      fontSize: fs(isPhone ? 10.5 : 12),
      lineHeight: fs(isPhone ? 14 : 16),
      fontWeight: '600',
    },
    footerInside: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingTop: s(compactLandscape ? 8 : 10),
      marginTop: s(compactLandscape ? 4 : 6),
      borderTopWidth: 1,
      borderTopColor: 'rgba(255,255,255,0.06)',
    },
    footerButton: {
      minWidth: s(isPhone ? 82 : 96),
      height: s(isPhone ? 38 : 42),
      borderRadius: s(13),
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: s(16),
    },
    cancelButton: {
      backgroundColor: '#050505',
      borderWidth: 1.6,
      borderColor: colors.white,
      marginRight: s(10),
    },
    startButton: {
      backgroundColor: '#D61F26',
      borderWidth: 1.6,
      borderColor: 'rgba(255,255,255,0.14)',
    },
    cancelText: {
      color: colors.white,
      fontSize: fs(isPhone ? 12.5 : 14),
      fontWeight: '700',
    },
    startText: {
      color: colors.white,
      fontSize: fs(isPhone ? 12.5 : 14),
      fontWeight: '800',
    },
    buttonPressed: {
      opacity: 0.86,
      transform: [{scale: 0.985}],
    },
    buttonDisabled: {
      opacity: 0.72,
    },
    liveLoadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 999,
      elevation: 999,
      backgroundColor: 'rgba(0,0,0,0.72)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: s(18),
    },
    liveLoadingCard: {
      width: Math.min(width ? width * 0.52 : 520, 560),
      minWidth: s(320),
      borderRadius: s(22),
      borderWidth: 1.3,
      borderColor: 'rgba(255, 42, 42, 0.62)',
      backgroundColor: '#101010',
      paddingVertical: s(28),
      paddingHorizontal: s(24),
      alignItems: 'center',
      shadowColor: '#FF1414',
      shadowOpacity: 0.32,
      shadowRadius: s(18),
      shadowOffset: {width: 0, height: 6},
      elevation: 18,
    },
    liveLoadingTitle: {
      color: '#FFFFFF',
      fontSize: fs(isPhone ? 18 : 22),
      fontWeight: '900',
      marginTop: s(16),
      textAlign: 'center',
    },
    liveLoadingMessage: {
      color: 'rgba(255,255,255,0.76)',
      fontSize: fs(isPhone ? 12.5 : 14),
      fontWeight: '700',
      lineHeight: fs(isPhone ? 17 : 19),
      marginTop: s(8),
      textAlign: 'center',
    },
  });
};

export default createStyles;
