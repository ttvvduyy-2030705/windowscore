import {StyleSheet} from 'react-native';

import {DesignSystem} from 'theme/designSystem';

type Metrics = {
  width: number;
  height: number;
};

const createStyles = (design: DesignSystem, metrics: Metrics) => {
  const {spacing, font, radius, icon, safeArea} = design;
  const compactLandscape = metrics.width <= 1440 && metrics.height <= 820;
  const mediumLaptop = metrics.width < 1920 && metrics.height <= 900;
  const topPadding = safeArea.top + (compactLandscape ? spacing.md : spacing.lg);
  const horizontalPadding = compactLandscape
    ? design.layout.screenPaddingX
    : mediumLaptop
      ? spacing.lg
      : spacing.xl;

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: '#000000',
      paddingHorizontal: horizontalPadding,
      paddingTop: topPadding,
      paddingBottom: safeArea.bottom + (compactLandscape ? spacing.md : spacing.lg),
    },

    topRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      zIndex: 20,
    },

    title: {
      color: '#FFFFFF',
      fontSize: font.titleLarge,
      fontWeight: '400',
    },

    rightTopWrap: {
      alignItems: 'flex-end',
    },

    greetingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: design.control.minTouch,
    },

    greetingText: {
      color: '#FFFFFF',
      fontSize: font.titleLarge,
      fontWeight: '400',
    },

    settingsIcon: {
      width: icon.lg,
      height: icon.lg,
      tintColor: '#FFFFFF',
    },

    historyPill: {
      marginTop: spacing.sm,
      minHeight: design.control.minTouch,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: 'rgba(28, 28, 28, 0.95)',
      flexDirection: 'row',
      alignItems: 'center',
    },

    historyIcon: {
      width: icon.sm,
      height: icon.sm,
      tintColor: '#B1B1B1',
      marginRight: spacing.xs,
    },

    historyText: {
      color: '#C6C6C6',
      fontSize: font.bodyLarge,
      fontWeight: '500',
    },

    centerZone: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },

    startButtonTouchArea: {
      alignItems: 'center',
      justifyContent: 'center',
    },

    startButtonWrap: {
      alignItems: 'center',
      justifyContent: 'center',
    },

    startButtonGlowOuter: {
      position: 'absolute',
      top: spacing.xs,
      left: spacing.sm,
      right: spacing.sm,
      bottom: 0,
      borderRadius: radius.xl,
      backgroundColor: 'rgba(255, 34, 10, 0.18)',
      shadowColor: '#ff2b14',
      shadowOffset: {width: 0, height: 0},
      shadowOpacity: 1,
      shadowRadius: spacing.lg,
      elevation: 18,
    },

    startButtonGlowInner: {
      position: 'absolute',
      top: spacing.xxs,
      left: spacing.xs,
      right: spacing.xs,
      bottom: spacing.xxs,
      borderRadius: radius.xl,
      borderWidth: design.border.regular,
      borderColor: 'rgba(255, 101, 54, 0.62)',
      shadowColor: '#ff5227',
      shadowOffset: {width: 0, height: 0},
      shadowOpacity: 0.95,
      shadowRadius: spacing.md,
      elevation: 13,
    },

    startButtonCore: {
      width: '100%',
      height: '100%',
      borderRadius: radius.xl,
      padding: spacing.xxs,
      borderWidth: design.border.strong,
      borderColor: '#ff4229',
    },

    startButtonInnerBorder: {
      flex: 1,
      borderRadius: radius.lg,
      borderWidth: design.border.thin,
      borderColor: 'rgba(255, 197, 128, 0.56)',
      backgroundColor: 'rgba(122, 7, 7, 0.30)',
      overflow: 'hidden',
    },

    startButtonContent: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },

    startGameIcon: {
      width: icon.lg,
      height: icon.lg,
      tintColor: '#f1d48d',
      marginRight: spacing.sm,
    },

    startButtonText: {
      color: '#f1d48d',
      fontSize: font.titleLarge,
      fontWeight: '700',
      letterSpacing: 0.2,
      textAlign: 'center',
    },

    logoBottomLayer: {
      alignItems: 'center',
      zIndex: 5,
    },

    logoBlock: {
      alignItems: 'center',
      justifyContent: 'center',
    },

    tagline: {
      marginTop: spacing.sm,
      color: '#FFFFFF',
      fontSize: font.bodyLarge,
      fontWeight: '400',
      letterSpacing: 0.15,
      textAlign: 'center',
    },
  });
};

export default createStyles;
