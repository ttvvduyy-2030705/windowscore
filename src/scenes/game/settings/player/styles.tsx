import {StyleSheet} from 'react-native';

import colors from 'configuration/colors';
import {LayoutPreset} from 'scenes/game/useAdaptiveLayout';

export const createStyles = (adaptive: {
  s: (value: number) => number;
  fs: (value: number) => number;
  layoutPreset: LayoutPreset;
  width?: number;
  height?: number;
  isLandscape?: boolean;
  isShortLandscape?: boolean;
}) => {
  const {s, fs, layoutPreset, width = 0, height = 0, isLandscape = false, isShortLandscape = false} = adaptive;
  const isPhone = layoutPreset === 'phone';
  const compactLandscape = isLandscape && (isShortLandscape || height <= 760 || width <= 1180);

  return StyleSheet.create({
    container: {
      paddingBottom: s(2),
    },
    mainTitle: {
      color: '#FFFFFF',
      fontSize: fs(isPhone ? 14 : 16),
      fontWeight: '800',
      marginBottom: s(10),
    },
    topControls: {
      paddingTop: 0,
      marginBottom: s(6),
    },
    controlRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: s(compactLandscape ? 6 : 8),
    },
    controlRowCompact: {
      marginBottom: s(7),
    },
    controlLabel: {
      width: compactLandscape ? s(isPhone ? 52 : 60) : s(isPhone ? 60 : 72),
      color: '#FFFFFF',
      fontSize: fs(isPhone ? 11 : compactLandscape ? 12 : 13),
      fontWeight: '700',
      marginRight: s(8),
      paddingTop: s(6),
    },
    controlOptionsRow: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    selectorButton: {
      minWidth: s(isPhone ? 30 : compactLandscape ? 32 : 36),
      minHeight: s(isPhone ? 26 : compactLandscape ? 28 : 31),
      paddingHorizontal: s(isPhone ? 8 : compactLandscape ? 9 : 11),
      paddingVertical: s(compactLandscape ? 3 : 4),
      marginRight: s(compactLandscape ? 4 : 6),
      marginBottom: s(compactLandscape ? 4 : 6),
      borderRadius: s(13),
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.28)',
      backgroundColor: '#4A4A4A',
      alignItems: 'center',
      justifyContent: 'center',
    },
    selectorButtonActive: {
      backgroundColor: '#E11D25',
      borderColor: '#E11D25',
    },
    selectorButtonPressed: {
      opacity: 0.88,
    },
    selectorButtonText: {
      color: colors.white,
      fontSize: fs(isPhone ? 11 : compactLandscape ? 12 : 13),
      fontWeight: '600',
    },
    selectorButtonTextActive: {
      color: colors.white,
      fontWeight: '700',
    },
    playerList: {
      paddingTop: 0,
    },
    playerCard: {
      borderRadius: s(14),
      paddingHorizontal: s(8),
      paddingVertical: s(8),
      marginBottom: s(compactLandscape ? 6 : 8),
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      flexDirection: 'row',
      alignItems: 'center',
    },
    playerCardPool: {
      backgroundColor: '#4A4A4A',
      borderColor: 'rgba(255,48,48,0.38)',
    },
    playerCardRight: {
      flex: 1,
      justifyContent: 'center',
      marginLeft: s(8),
      minWidth: 0,
    },
    playerCardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: s(compactLandscape ? 30 : 34),
    },
    avatarText: {
      color: '#1A1A1A',
      fontSize: fs(22),
      lineHeight: fs(24),
      fontWeight: '700',
      textAlign: 'center',
      textAlignVertical: 'center',
      includeFontPadding: false,
    },
    avatarTextLight: {
      color: colors.white,
    },
    nameInput: {
      flex: 1,
      height: s(compactLandscape ? 30 : 34),
      borderRadius: s(10),
      backgroundColor: '#F5F0DA',
      paddingHorizontal: s(10),
      paddingVertical: 0,
      color: '#1A1A1A',
      fontSize: fs(isPhone ? 11.5 : compactLandscape ? 12.5 : 13.5),
      lineHeight: fs(16),
      fontWeight: '500',
      textAlignVertical: 'center',
    },
    nameInputPool: {
      backgroundColor: '#D9D9D9',
      color: '#1B1B1B',
    },
    scoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: s(10),
      backgroundColor: '#F5F0DA',
      overflow: 'hidden',
      marginTop: s(compactLandscape ? 6 : 8),
    },
    scoreRowPool: {
      backgroundColor: '#6A6A6A',
    },
    scoreItem: {
      flex: 1,
      minHeight: s(isPhone ? 20 : compactLandscape ? 22 : 24),
      alignItems: 'center',
      justifyContent: 'center',
      borderRightWidth: 1,
      borderRightColor: 'rgba(0,0,0,0.12)',
    },
    scoreItemPool: {
      borderRightColor: 'rgba(255,255,255,0.18)',
    },
    scoreItemCenter: {
      backgroundColor: '#EEE6C5',
    },
    scoreItemCenterPool: {
      backgroundColor: '#E11D25',
    },
    scoreText: {
      color: '#202020',
      fontSize: fs(isPhone ? 9.5 : compactLandscape ? 10.5 : 11.5),
      fontWeight: '500',
    },
    scoreTextPool: {
      color: colors.white,
    },
    scoreTextCenter: {
      fontWeight: '700',
    },
    countryModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: s(20),
    },
    countryModalCard: {
      width: '100%',
      maxWidth: s(420),
      maxHeight: '72%',
      backgroundColor: '#1F1F1F',
      borderRadius: s(14),
      borderWidth: 1,
      borderColor: 'rgba(255,0,0,0.28)',
      padding: s(14),
    },
    countryModalTitle: {
      color: '#FFFFFF',
      fontSize: fs(16),
      fontWeight: '700',
      marginBottom: s(10),
    },
    countrySearchInput: {
      height: s(42),
      borderRadius: s(10),
      backgroundColor: '#2B2B2B',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      color: '#FFFFFF',
      paddingHorizontal: s(12),
      marginBottom: s(10),
    },
    countryList: {
      flexGrow: 0,
    },
    countryItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: s(10),
      paddingHorizontal: s(8),
      borderRadius: s(10),
    },
    countryItemPressed: {
      backgroundColor: 'rgba(255,255,255,0.06)',
    },
    countryFlag: {
      width: s(28),
      fontSize: fs(20),
      marginRight: s(10),
      textAlign: 'center',
    },
    countryName: {
      color: '#FFFFFF',
      fontSize: fs(15),
      flex: 1,
    },
    countryEmptyText: {
      color: '#B8B8B8',
      fontSize: fs(14),
      textAlign: 'center',
      paddingVertical: s(20),
    },
  });
};

export default createStyles;
