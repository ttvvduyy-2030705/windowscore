import colors from 'configuration/colors';
import {StyleSheet} from 'react-native';

import {DesignSystem} from 'theme/designSystem';

type AdaptiveLike = {
  s: (value: number) => number;
  fs: (value: number, minFactor?: number, maxFactor?: number) => number;
};

const createStyles = (adaptive: AdaptiveLike, design: DesignSystem) => {
  const {spacing, radius, icon, font} = design;

  return StyleSheet.create({
    buttonBack: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
      marginTop: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.yellow,
      width: '100%',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: design.control.buttonHeight,
    },
    button: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: design.control.buttonHeight,
    },
    buttonSelected: {
      backgroundColor: colors.statusBar,
    },
    webcamContainer: {
      backgroundColor: colors.black,
      height: '100%',
      width: '100%',
      overflow: 'hidden',
      borderRadius: radius.lg,
    },
    webcam: {
      width: '100%',
      height: '100%',
      backgroundColor: colors.black,
      marginLeft: 0.5,
    },
    videoResize: {
      width: adaptive.s(300),
      height: adaptive.s(200),
      backgroundColor: 'black',
    },
    fullWidth: {
      width: '100%',
    },
    iconBack: {
      width: icon.sm,
      height: icon.sm,
      marginRight: spacing.xs,
    },
    buttonShare: {
      position: 'absolute',
      top: spacing.md,
      right: spacing.md,
      padding: spacing.md,
      backgroundColor: colors.lightPrimary1,
      borderRadius: radius.md,
    },
    iconShare: {
      width: icon.lg,
      height: icon.lg,
    },
    container: {flex: 1, alignItems: 'center', justifyContent: 'center'},
    video: {width: '90%', height: adaptive.s(300)},
    label: {marginTop: spacing.sm, fontSize: font.body},
    slider: {width: adaptive.s(150), marginTop: spacing.sm, alignItems: 'center'},
    controls: {flexDirection: 'row', marginTop: spacing.sm},
    itemContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
      marginTop: spacing.sm,
      justifyContent: 'space-between',
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    selectITem: {
      width: '100%',
      backgroundColor: 'rgba(216,32,39,0.95)',
      borderColor: 'rgba(255,255,255,0.72)',
    },
    unselectItem: {
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderColor: 'rgba(255,255,255,0.22)',
    },
    thumbnail: {
      width: adaptive.s(120),
      height: adaptive.s(90),
      borderRadius: radius.sm,
    },
    thumbnailPlaceholder: {
      borderRadius: radius.sm,
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderWidth: design.border.hairline,
      borderColor: 'rgba(255,255,255,0.28)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.xs,
    },
    thumbnailIndex: {
      color: colors.white,
      fontSize: font.small,
      fontWeight: '900',
    },
    details: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    duration: {
      fontSize: font.body,
      fontWeight: '900',
      color: colors.white,
    },
    selectorTitle: {
      color: colors.white,
      fontSize: font.small,
      fontWeight: '800',
      marginBottom: spacing.xs,
      alignSelf: 'flex-start',
    },
    selectorScroll: {
      height: adaptive.s(300),
      width: adaptive.s(170),
    },
    rateButton: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: 'rgba(255,255,255,0.10)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.22)',
      alignItems: 'center',
      justifyContent: 'center',
      width: adaptive.s(170),
    },
    rateButtonText: {
      color: colors.white,
      fontSize: font.body,
      fontWeight: '900',
    },
    videoContainer: {
      flex: 1,
    },
  });
};

export default createStyles;
