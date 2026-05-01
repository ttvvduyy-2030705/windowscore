import {adaptiveFont, adaptiveSize} from 'utils/adaptive';

import createDesignSystem from 'theme/designSystem';
import type {LayoutPreset} from 'utils/adaptive';

type AdaptiveLike = {
  s?: (value: number) => number;
  fs?: (value: number, minFactor?: number, maxFactor?: number) => number;
  layoutPreset?: LayoutPreset;
  isLandscape?: boolean;
  width?: number;
  height?: number;
  widthClass?: 'compact' | 'medium' | 'expanded';
  breakpoint?: 'compact' | 'medium' | 'large' | 'xlarge';
  isShortLandscape?: boolean;
};

export type BrandedScreenMetrics = {
  s: (value: number) => number;
  fs: (value: number, minFactor?: number, maxFactor?: number) => number;
  layoutPreset: LayoutPreset;
  isLandscape: boolean;
  isPhone: boolean;
  compactLandscape: boolean;
  screenPaddingX: number;
  screenPaddingTop: number;
  screenPaddingBottom: number;
  headerHeight: number;
  headerRadius: number;
  headerSidePadding: number;
  headerTitlePadding: number;
  backButtonHeight: number;
  backButtonMinWidth: number;
  backButtonRadius: number;
  panelRadius: number;
  panelPadding: number;
  cardRadius: number;
  fieldRadius: number;
  buttonHeight: number;
  buttonRadius: number;
  sectionGap: number;
};

export const getBrandedScreenMetrics = (
  adaptive: AdaptiveLike = {},
): BrandedScreenMetrics => {
  const s = adaptive.s || ((value: number) => adaptiveSize(value));
  const fs =
    adaptive.fs ||
    ((value: number, minFactor = 0.82, maxFactor = 1.08) =>
      adaptiveFont(value, {minFactor, maxFactor}));

  const layoutPreset = adaptive.layoutPreset || 'tablet';
  const isLandscape = adaptive.isLandscape !== false;
  const width = adaptive.width || 0;
  const height = adaptive.height || 0;
  const design = createDesignSystem(
    {
      width,
      height,
      layoutPreset,
      isLandscape,
      widthClass: adaptive.widthClass,
      breakpoint: adaptive.breakpoint,
      s,
      fs,
    },
    {top: 0, right: 0, bottom: 0, left: 0},
  );
  const isPhone = layoutPreset === 'phone';
  const compactLandscape =
    isLandscape &&
    (adaptive.breakpoint === 'compact' ||
      adaptive.isShortLandscape ||
      (height <= 820 && width <= 1440) ||
      height <= 760 ||
      width <= 1180);

  return {
    s,
    fs,
    layoutPreset,
    isLandscape,
    isPhone,
    compactLandscape,
    screenPaddingX: design.layout.screenPaddingX,
    screenPaddingTop: design.layout.screenPaddingY,
    screenPaddingBottom: design.layout.screenPaddingY,
    headerHeight: design.control.headerHeight,
    headerRadius: design.radius.xl,
    headerSidePadding: design.spacing.md,
    headerTitlePadding: compactLandscape
      ? s(104)
      : layoutPreset === 'tv'
        ? s(176)
        : layoutPreset === 'wideTablet'
          ? s(164)
          : s(144),
    backButtonHeight: s(isPhone ? 42 : compactLandscape ? 48 : 52),
    backButtonMinWidth: s(isPhone ? 98 : compactLandscape ? 108 : 116),
    backButtonRadius: design.radius.md,
    panelRadius: design.radius.xl,
    panelPadding: design.spacing.md,
    cardRadius: design.radius.lg,
    fieldRadius: design.radius.md,
    buttonHeight: design.control.buttonHeight,
    buttonRadius: design.radius.md,
    sectionGap: design.layout.sectionGap,
  };
};

export default getBrandedScreenMetrics;
