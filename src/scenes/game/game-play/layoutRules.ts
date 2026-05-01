import {StyleSheet} from 'react-native';

import type {DesignSystem} from 'theme/designSystem';
import type {AdaptiveLayout} from '../useAdaptiveLayout';

type StyleRecord = Record<string, any>;

type GameplayStyleValue =
  | number
  | string
  | boolean
  | null
  | undefined
  | StyleRecord
  | GameplayStyleValue[];

const FONT_KEYS = new Set([
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textShadowRadius',
]);

const SPACING_KEYS = new Set([
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'padding',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingHorizontal',
  'paddingVertical',
  'gap',
  'rowGap',
  'columnGap',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderWidth',
  'borderTopWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'minBorderRadius',
  'elevation',
  'shadowRadius',
]);

const WIDTH_KEYS = new Set([
  'width',
  'minWidth',
  'maxWidth',
  'left',
  'right',
  'translateX',
]);

const HEIGHT_KEYS = new Set([
  'height',
  'minHeight',
  'maxHeight',
  'top',
  'bottom',
  'translateY',
]);

const shouldKeepRaw = (key: string, value: number) => {
  if (!Number.isFinite(value)) {
    return true;
  }

  if (value === 0) {
    return true;
  }

  if (
    key === 'flex' ||
    key === 'flexGrow' ||
    key === 'flexShrink' ||
    key === 'opacity' ||
    key === 'zIndex' ||
    key === 'fontWeight' ||
    key === 'aspectRatio' ||
    key === 'shadowOpacity'
  ) {
    return true;
  }

  return false;
};

const scaleSigned = (value: number, scaleFn: (input: number) => number) => {
  if (!Number.isFinite(value) || value === 0) {
    return value;
  }

  const sign = value < 0 ? -1 : 1;
  return scaleFn(Math.abs(value)) * sign;
};

const scaleStyleValue = (
  adaptive: AdaptiveLayout,
  key: string,
  value: GameplayStyleValue,
): GameplayStyleValue => {
  if (Array.isArray(value)) {
    return value.map(item => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return scaleStyleObject(adaptive, item as StyleRecord);
      }
      return item;
    });
  }

  if (value && typeof value === 'object') {
    return scaleStyleObject(adaptive, value as StyleRecord);
  }

  if (typeof value !== 'number' || shouldKeepRaw(key, value)) {
    return value;
  }

  if (FONT_KEYS.has(key)) {
    return scaleSigned(value, input => adaptive.fs(input));
  }

  if (WIDTH_KEYS.has(key) || HEIGHT_KEYS.has(key) || SPACING_KEYS.has(key)) {
    return scaleSigned(value, input => adaptive.s(input));
  }

  return value;
};

const scaleStyleObject = (adaptive: AdaptiveLayout, record: StyleRecord): StyleRecord => {
  return Object.entries(record).reduce<StyleRecord>((result, [key, value]) => {
    result[key] = scaleStyleValue(adaptive, key, value as GameplayStyleValue);
    return result;
  }, {});
};

export const createGameplayStyles = <T extends StyleRecord>(
  adaptive: AdaptiveLayout,
  styles: T,
) => {
  const scaled = Object.entries(styles).reduce<Record<string, any>>((result, [key, value]) => {
    result[key] = scaleStyleObject(adaptive, value as StyleRecord);
    return result;
  }, {});

  return StyleSheet.create(scaled) as T;
};

export type GameplayLayoutRules = {
  screenPaddingX: number;
  screenPaddingY: number;
  blockGap: number;
  panelGap: number;
  panelRadius: number;
  panelBorderWidth: number;
  headerHeight: number;
  controlHeights: {
    compact: number;
    regular: number;
    prominent: number;
  };
  playerConsoleRatio: {
    side: number;
    center: number;
  };
  camera: {
    stageMinHeight: number;
    fullscreenRailWidth: number;
    overlayInset: number;
    cardRadius: number;
  };
  scoreboard: {
    scoreFont: number;
    compactScoreFont: number;
    heroScoreFont: number;
  };
};

export const createGameplayLayoutRules = (
  adaptive: AdaptiveLayout,
  design: DesignSystem,
): GameplayLayoutRules => {
  const compactLandscape =
    adaptive.isLandscape &&
    (adaptive.breakpoint === 'compact' ||
      adaptive.width < 1440 ||
      adaptive.height <= 760 ||
      adaptive.isConstrainedLandscape ||
      adaptive.widthClass === 'compact');
  const mediumLaptopLandscape =
    adaptive.isLandscape &&
    adaptive.breakpoint === 'medium' &&
    adaptive.layoutPreset !== 'tv' &&
    adaptive.height <= 900;

  const compactScreen =
    compactLandscape || adaptive.shortSide <= 430 || adaptive.layoutPreset === 'phone';

  return {
    screenPaddingX: Math.max(design.layout.screenPaddingX, adaptive.s(compactScreen ? 8 : 12)),
    screenPaddingY: Math.max(design.layout.screenPaddingY, adaptive.s(compactLandscape ? 6 : 10)),
    blockGap: adaptive.s(compactLandscape ? 8 : mediumLaptopLandscape ? 10 : adaptive.layoutPreset === 'tv' ? 16 : 12),
    panelGap: adaptive.s(compactLandscape ? 6 : mediumLaptopLandscape ? 8 : 10),
    panelRadius: adaptive.s(compactScreen ? 20 : adaptive.layoutPreset === 'tv' ? 32 : 28),
    panelBorderWidth: Math.max(design.border.thin, adaptive.s(1.2)),
    headerHeight: adaptive.s(compactLandscape ? 48 : mediumLaptopLandscape ? 58 : adaptive.layoutPreset === 'tv' ? 78 : 68),
    controlHeights: {
      compact: adaptive.s(compactLandscape ? 42 : 48),
      regular: adaptive.s(compactLandscape ? 48 : 56),
      prominent: adaptive.s(compactLandscape ? 56 : adaptive.layoutPreset === 'tv' ? 84 : 72),
    },
    playerConsoleRatio: {
      side: compactLandscape ? 0.78 : mediumLaptopLandscape ? 0.88 : adaptive.layoutPreset === 'wideTablet' ? 0.94 : 1,
      center: compactLandscape ? 1.42 : mediumLaptopLandscape ? 1.24 : adaptive.layoutPreset === 'wideTablet' ? 1.1 : 1.02,
    },
    camera: {
      stageMinHeight: adaptive.s(compactLandscape ? 168 : mediumLaptopLandscape ? 204 : adaptive.layoutPreset === 'tv' ? 320 : 228),
      fullscreenRailWidth: adaptive.s(compactLandscape ? 56 : 64),
      overlayInset: adaptive.s(compactLandscape ? 10 : 12),
      cardRadius: adaptive.s(compactLandscape ? 16 : 20),
    },
    scoreboard: {
      scoreFont: adaptive.fs(compactScreen ? 84 : 112, 0.72, 1.02),
      compactScoreFont: adaptive.fs(compactScreen ? 68 : 92, 0.72, 1.02),
      heroScoreFont: adaptive.fs(compactScreen ? 132 : 188, 0.72, 1.04),
    },
  };
};

export default createGameplayLayoutRules;
