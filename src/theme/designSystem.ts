import colors from 'configuration/colors';
import {
  fontScale as responsiveFontScale,
  getResponsiveMetrics,
  ResponsivePreset,
  scale,
} from 'utils/responsive';

import {EdgeInsets, ZERO_INSETS} from './safeArea';

export type DesignSystemAdaptiveLike = {
  width?: number;
  height?: number;
  layoutPreset?: ResponsivePreset;
  breakpoint?: 'compact' | 'medium' | 'large' | 'xlarge';
  isLandscape?: boolean;
  widthClass?: 'compact' | 'medium' | 'expanded';
  s?: (value: number) => number;
  fs?: (value: number, minFactor?: number, maxFactor?: number) => number;
};

export type DesignSystem = {
  colors: typeof colors & {
    surface: string;
    surfaceAlt: string;
    surfaceRaised: string;
    accent: string;
    accentSoft: string;
    borderSubtle: string;
    borderStrong: string;
    textPrimary: string;
    textSecondary: string;
  };
  spacing: {
    xxs: number;
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  font: {
    small: number;
    body: number;
    bodyLarge: number;
    label: number;
    title: number;
    titleLarge: number;
    score: number;
    hero: number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    pill: number;
  };
  icon: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  border: {
    hairline: number;
    thin: number;
    regular: number;
    strong: number;
  };
  control: {
    minTouch: number;
    buttonHeight: number;
    fieldHeight: number;
    headerHeight: number;
  };
  layout: {
    compact: boolean;
    stacked: boolean;
    sectionGap: number;
    panelGap: number;
    screenPaddingX: number;
    screenPaddingY: number;
  };
  safeArea: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

export const createDesignSystem = (
  adaptive: DesignSystemAdaptiveLike = {},
  insets: EdgeInsets = ZERO_INSETS,
): DesignSystem => {
  const metrics = getResponsiveMetrics({
    width: adaptive.width,
    height: adaptive.height,
  });

  const layoutPreset = adaptive.layoutPreset || metrics.layoutPreset;
  const breakpoint = adaptive.breakpoint || metrics.breakpoint;
  const widthClass = adaptive.widthClass || metrics.widthClass;
  const compact = layoutPreset === 'phone' || widthClass === 'compact' || breakpoint === 'compact';
  const stacked = !adaptive.isLandscape && layoutPreset !== 'tv';

  const s =
    adaptive.s ||
    ((value: number) =>
      scale(value, metrics.width, metrics.height, {
        minFactor: 0.78,
        maxFactor: layoutPreset === 'tv' ? 1.14 : 1.08,
      }));

  const fs =
    adaptive.fs ||
    ((value: number, minFactor = 0.82, maxFactor = 1.04) =>
      responsiveFontScale(value, metrics.width, metrics.height, {
        minFactor,
        maxFactor,
      }));

  return {
    colors: {
      ...colors,
      surface: '#050505',
      surfaceAlt: '#0E0E10',
      surfaceRaised: '#15161B',
      accent: '#C91D24',
      accentSoft: 'rgba(201, 29, 36, 0.16)',
      borderSubtle: 'rgba(255,255,255,0.08)',
      borderStrong: 'rgba(255, 52, 52, 0.24)',
      textPrimary: '#FFFFFF',
      textSecondary: '#9B9B9B',
    },
    spacing: {
      xxs: s(4),
      xs: s(8),
      sm: s(12),
      md: s(16),
      lg: s(24),
      xl: s(32),
      xxl: s(40),
    },
    font: {
      small: fs(11),
      body: fs(14),
      bodyLarge: fs(16),
      label: fs(18),
      title: fs(compact ? 18 : 22),
      titleLarge: fs(compact ? 22 : 28),
      score: fs(compact ? 72 : 96, 0.76, 1.08),
      hero: fs(compact ? 112 : 160, 0.72, 1.08),
    },
    radius: {
      sm: s(8),
      md: s(12),
      lg: s(18),
      xl: s(24),
      pill: s(999),
    },
    icon: {
      xs: s(14),
      sm: s(18),
      md: s(24),
      lg: s(32),
      xl: s(40),
    },
    border: {
      hairline: 1,
      thin: Math.max(1, s(1)),
      regular: Math.max(1, s(1.5)),
      strong: Math.max(1.25, s(2)),
    },
    control: {
      minTouch: s(44),
      buttonHeight: s(compact ? 44 : 52),
      fieldHeight: s(compact ? 46 : 54),
      headerHeight: s(compact ? 52 : 64),
    },
    layout: {
      compact,
      stacked,
      sectionGap: s(compact ? 12 : 16),
      panelGap: s(compact ? 10 : 14),
      screenPaddingX: s(compact ? (breakpoint === 'compact' ? 8 : 12) : 16),
      screenPaddingY: s(compact ? (breakpoint === 'compact' ? 6 : 10) : 12),
    },
    safeArea: {
      top: Math.max(insets.top, 0),
      right: Math.max(insets.right, 0),
      bottom: Math.max(insets.bottom, 0),
      left: Math.max(insets.left, 0),
    },
  };
};

export default createDesignSystem;
