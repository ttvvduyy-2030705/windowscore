import {useEffect, useMemo, useState} from 'react';
import {useWindowDimensions} from 'react-native';

import {
  buildFallbackSystemScreenMetrics,
  getSystemScreenMetrics,
  SystemScreenMetrics,
} from './systemScreenMetrics';
import {
  fontScale,
  getResponsiveMetrics,
  ResponsiveBreakpointName,
  ResponsivePreset,
  ResponsiveWidthClass,
  scale,
} from 'utils/responsive';

export type WidthClass = ResponsiveWidthClass;
export type LayoutPreset = ResponsivePreset;
export type LayoutBreakpoint = ResponsiveBreakpointName;

export type AdaptiveLayout = {
  width: number;
  height: number;
  shortSide: number;
  longSide: number;
  aspectRatio: number;
  isLandscape: boolean;
  isShortLandscape: boolean;
  isVeryShortLandscape: boolean;
  isUltraShortLandscape: boolean;
  isConstrainedLandscape: boolean;
  widthClass: WidthClass;
  breakpoint: LayoutBreakpoint;
  layoutPreset: LayoutPreset;
  scale: number;
  sizeScale: number;
  textScale: number;
  styleKey: string;
  systemMetrics: SystemScreenMetrics;
  s: (value: number) => number;
  fs: (value: number, minFactor?: number, maxFactor?: number) => number;
};

export const useAdaptiveLayout = (): AdaptiveLayout => {
  const {width, height, fontScale: nativeFontScale} = useWindowDimensions();
  const [systemMetrics, setSystemMetrics] = useState<SystemScreenMetrics>(() =>
    buildFallbackSystemScreenMetrics(width, height, nativeFontScale || 1),
  );

  useEffect(() => {
    let mounted = true;

    const sync = async () => {
      const next = await getSystemScreenMetrics(width, height, nativeFontScale || 1);
      if (mounted) {
        setSystemMetrics(next);
      }
    };

    void sync();

    return () => {
      mounted = false;
    };
  }, [width, height, nativeFontScale]);

  return useMemo(() => {
    const metrics = getResponsiveMetrics({
      width,
      height,
      fontScale: nativeFontScale || systemMetrics.fontScale || 1,
      smallestDp: systemMetrics.smallestScreenWidthDp,
    });

    const s = (value: number) => scale(value, metrics.width, metrics.height, {
      minFactor: 0.78,
      maxFactor: metrics.layoutPreset === 'tv' ? 1.14 : 1.08,
    });

    const fs = (value: number, minFactor = 0.82, maxFactor = 1.04) =>
      fontScale(value, metrics.width, metrics.height, {minFactor, maxFactor});

    return {
      width: metrics.width,
      height: metrics.height,
      shortSide: metrics.shortSide,
      longSide: metrics.longSide,
      aspectRatio: metrics.aspectRatio,
      isLandscape: metrics.isLandscape,
      isShortLandscape: metrics.isShortLandscape,
      isVeryShortLandscape: metrics.isVeryShortLandscape,
      isUltraShortLandscape: metrics.isUltraShortLandscape,
      isConstrainedLandscape: metrics.isConstrainedLandscape,
      widthClass: metrics.widthClass,
      breakpoint: metrics.breakpoint,
      layoutPreset: metrics.layoutPreset,
      scale: metrics.scale,
      sizeScale: metrics.sizeScale,
      textScale: metrics.textScale,
      styleKey: `${Math.round(metrics.width)}x${Math.round(metrics.height)}-${metrics.breakpoint}-${metrics.layoutPreset}-${metrics.widthClass}-${Math.round(metrics.scale * 1000)}`,
      systemMetrics,
      s,
      fs,
    };
  }, [height, nativeFontScale, systemMetrics, width]);
};

export default useAdaptiveLayout;
