import {Dimensions, PixelRatio} from 'react-native';

export const BASE_WIDTH = 1280;
export const BASE_HEIGHT = 800;
const BASE_ASPECT = BASE_WIDTH / BASE_HEIGHT;

export type ResponsiveWidthClass = 'compact' | 'medium' | 'expanded';
export type ResponsivePreset = 'phone' | 'tablet' | 'wideTablet' | 'tv';
export type ResponsiveBreakpointName = 'compact' | 'medium' | 'large' | 'xlarge';

export const RESPONSIVE_BREAKPOINTS = {
  compact: {maxWidth: 1439, maxHeight: 820},
  medium: {maxWidth: 1919, maxHeight: 1000},
  large: {minWidth: 1920, minHeight: 1000},
  xlarge: {minWidth: 2560, minHeight: 1200},
} as const;

export type ResponsiveMetrics = {
  width: number;
  height: number;
  shortSide: number;
  longSide: number;
  aspectRatio: number;
  isLandscape: boolean;
  smallestDp: number;
  widthClass: ResponsiveWidthClass;
  breakpoint: ResponsiveBreakpointName;
  layoutPreset: ResponsivePreset;
  scaleX: number;
  scaleY: number;
  scale: number;
  textScale: number;
  sizeScale: number;
  moderateScale: number;
  isShortLandscape: boolean;
  isVeryShortLandscape: boolean;
  isUltraShortLandscape: boolean;
  isConstrainedLandscape: boolean;
  isLaptopLikeLandscape: boolean;
  isLargeDesktop: boolean;
};

export type ResponsiveHelperOptions = {
  minFactor?: number;
  maxFactor?: number;
};

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const round = (value: number) => {
  const next = PixelRatio.roundToNearestPixel(value);
  return Number.isFinite(next) ? next : value;
};

const getSafeWindow = (widthArg?: number, heightArg?: number) => {
  const window = Dimensions.get('window');
  const width = Number.isFinite(widthArg) && (widthArg || 0) > 0 ? Number(widthArg) : window.width;
  const height = Number.isFinite(heightArg) && (heightArg || 0) > 0 ? Number(heightArg) : window.height;

  return {
    width: width > 0 ? width : 1,
    height: height > 0 ? height : 1,
  };
};

export const getResponsiveMetrics = (params?: {
  width?: number;
  height?: number;
  fontScale?: number;
  smallestDp?: number;
}): ResponsiveMetrics => {
  const {width, height} = getSafeWindow(params?.width, params?.height);
  const fontScale = Number.isFinite(params?.fontScale) && (params?.fontScale || 0) > 0
    ? Number(params?.fontScale)
    : PixelRatio.getFontScale();

  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const aspectRatio = longSide / Math.max(shortSide, 1);
  const isLandscape = width >= height;
  const smallestDp = Number.isFinite(params?.smallestDp) && (params?.smallestDp || 0) > 0
    ? Number(params?.smallestDp)
    : shortSide;

  const widthClass: ResponsiveWidthClass =
    width < 960 ? 'compact' : width < 1440 ? 'medium' : 'expanded';

  const isLargeDesktop =
    isLandscape &&
    width >= RESPONSIVE_BREAKPOINTS.large.minWidth &&
    height >= RESPONSIVE_BREAKPOINTS.large.minHeight &&
    smallestDp >= 900;
  const isCompactDesktopLandscape =
    isLandscape &&
    !isLargeDesktop &&
    (width < 1440 || (width < 1600 && height <= RESPONSIVE_BREAKPOINTS.compact.maxHeight));
  const isMediumDesktopLandscape =
    isLandscape && !isLargeDesktop && width < RESPONSIVE_BREAKPOINTS.large.minWidth && height <= RESPONSIVE_BREAKPOINTS.medium.maxHeight;
  const isLaptopLikeLandscape = isLandscape && !isLargeDesktop && (height <= 1000 || width < 1920);

  const breakpoint: ResponsiveBreakpointName =
    width >= RESPONSIVE_BREAKPOINTS.xlarge.minWidth && height >= RESPONSIVE_BREAKPOINTS.xlarge.minHeight
      ? 'xlarge'
      : isLargeDesktop
        ? 'large'
        : isCompactDesktopLandscape
          ? 'compact'
          : 'medium';

  const isTablet = smallestDp >= 600;
  const isTv = isLargeDesktop;
  const isConstrainedLandscape =
    isLandscape &&
    !isLargeDesktop &&
    (smallestDp < 600 ||
      isCompactDesktopLandscape ||
      height <= 760 ||
      (width < RESPONSIVE_BREAKPOINTS.large.minWidth && aspectRatio >= 1.9));

  let layoutPreset: ResponsivePreset = 'phone';
  if (isTv) {
    layoutPreset = 'tv';
  } else if (isTablet && isLandscape && aspectRatio >= 1.35) {
    layoutPreset = 'wideTablet';
  } else if (isTablet && !isConstrainedLandscape) {
    layoutPreset = 'tablet';
  }

  const laptopShortThreshold = isCompactDesktopLandscape ? 820 : isMediumDesktopLandscape ? 760 : 700;
  const isShortLandscape = isLandscape && height <= laptopShortThreshold;
  const isVeryShortLandscape = isLandscape && height <= (isCompactDesktopLandscape ? 760 : isMediumDesktopLandscape ? 700 : 620);
  const isUltraShortLandscape = isLandscape && height <= (isCompactDesktopLandscape ? 680 : 560);

  const widthFactor = width / BASE_WIDTH;
  const heightFactor = height / BASE_HEIGHT;

  const landscapePrimary = heightFactor * 0.74 + widthFactor * 0.26;
  const portraitPrimary = heightFactor * 0.62 + widthFactor * 0.38;
  const baseScale = isLandscape ? landscapePrimary : portraitPrimary;

  const aspectPenalty = isLandscape
    ? clamp((aspectRatio - BASE_ASPECT) * (isConstrainedLandscape ? 0.18 : 0.08), 0, isConstrainedLandscape ? 0.26 : 0.12)
    : 0;

  const shortPenalty = isUltraShortLandscape
    ? (isConstrainedLandscape ? 0.18 : 0.12)
    : isVeryShortLandscape
      ? (isConstrainedLandscape ? 0.12 : 0.08)
      : isShortLandscape
        ? (isConstrainedLandscape ? 0.08 : 0.04)
        : 0;

  const laptopPenalty = isLandscape
    ? isCompactDesktopLandscape
      ? 0.08
      : width <= 1600 && height <= 900
        ? 0.05
        : isLaptopLikeLandscape
          ? 0.03
          : 0
    : 0;

  const minScale = layoutPreset === 'tv' ? 0.92 : isConstrainedLandscape ? 0.66 : layoutPreset === 'phone' ? 0.72 : 0.78;
  const maxScale = layoutPreset === 'tv' ? 1.16 : isLaptopLikeLandscape ? 1 : isConstrainedLandscape ? 0.96 : 1.04;
  const scale = clamp(baseScale - aspectPenalty - shortPenalty - laptopPenalty, minScale, maxScale);

  const normalizedFontScale = clamp(fontScale, 1, 1.15);
  const textScale = clamp(
    scale / normalizedFontScale,
    isConstrainedLandscape ? 0.68 : layoutPreset === 'phone' ? 0.78 : 0.84,
    layoutPreset === 'tv' ? 1.08 : 1.02,
  );

  return {
    width,
    height,
    shortSide,
    longSide,
    aspectRatio,
    isLandscape,
    smallestDp,
    widthClass,
    breakpoint,
    layoutPreset,
    scaleX: clamp(widthFactor, 0.72, 1.16),
    scaleY: clamp(heightFactor, 0.72, 1.12),
    scale,
    textScale,
    sizeScale: scale,
    moderateScale: clamp(scale, 0.72, 1.08),
    isShortLandscape,
    isVeryShortLandscape,
    isUltraShortLandscape,
    isConstrainedLandscape,
    isLaptopLikeLandscape,
    isLargeDesktop,
  };
};

export const scaleX = (value: number, width?: number, height?: number, options?: ResponsiveHelperOptions) => {
  const metrics = getResponsiveMetrics({width, height});
  const minFactor = options?.minFactor ?? 0.78;
  const maxFactor = options?.maxFactor ?? 1.12;
  return round(clamp(value * metrics.scaleX, value * minFactor, value * maxFactor));
};

export const scaleY = (value: number, width?: number, height?: number, options?: ResponsiveHelperOptions) => {
  const metrics = getResponsiveMetrics({width, height});
  const minFactor = options?.minFactor ?? 0.78;
  const maxFactor = options?.maxFactor ?? 1.1;
  return round(clamp(value * metrics.scaleY, value * minFactor, value * maxFactor));
};

export const scale = (value: number, width?: number, height?: number, options?: ResponsiveHelperOptions) => {
  const metrics = getResponsiveMetrics({width, height});
  const minFactor = options?.minFactor ?? 0.78;
  const maxFactor = options?.maxFactor ?? 1.08;
  return round(clamp(value * metrics.scale, value * minFactor, value * maxFactor));
};

export const moderateScale = (
  value: number,
  factor = 0.5,
  width?: number,
  height?: number,
  options?: ResponsiveHelperOptions,
) => {
  const metrics = getResponsiveMetrics({width, height});
  const scaled = value + (value * metrics.moderateScale - value) * factor;
  const minFactor = options?.minFactor ?? 0.8;
  const maxFactor = options?.maxFactor ?? 1.08;
  return round(clamp(scaled, value * minFactor, value * maxFactor));
};

export const fontScale = (
  value: number,
  width?: number,
  height?: number,
  options?: ResponsiveHelperOptions,
) => {
  const metrics = getResponsiveMetrics({width, height});
  const minFactor = options?.minFactor ?? 0.82;
  const maxFactor = options?.maxFactor ?? 1.04;
  return round(clamp(value * metrics.textScale, value * minFactor, value * maxFactor));
};

export default getResponsiveMetrics;
