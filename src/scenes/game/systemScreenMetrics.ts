export type SystemScreenMetrics = {
  screenWidthDp: number;
  screenHeightDp: number;
  smallestScreenWidthDp: number;
  densityDpi: number;
  density: number;
  fontScale: number;
  orientation: 'portrait' | 'landscape';
  isTablet: boolean;
  windowWidthPx: number;
  windowHeightPx: number;
  source: 'native' | 'fallback';
};

export const buildFallbackSystemScreenMetrics = (
  widthDp: number,
  heightDp: number,
  fontScale: number,
): SystemScreenMetrics => {
  const safeWidth = Number.isFinite(widthDp) && widthDp > 0 ? widthDp : 1;
  const safeHeight = Number.isFinite(heightDp) && heightDp > 0 ? heightDp : 1;
  const smallest = Math.min(safeWidth, safeHeight);
  return {
    screenWidthDp: safeWidth,
    screenHeightDp: safeHeight,
    smallestScreenWidthDp: smallest,
    densityDpi: 160,
    density: 1,
    fontScale,
    orientation: safeWidth >= safeHeight ? 'landscape' : 'portrait',
    isTablet: smallest >= 600,
    windowWidthPx: safeWidth,
    windowHeightPx: safeHeight,
    source: 'fallback',
  };
};

export const getSystemScreenMetrics = async (
  widthDp: number,
  heightDp: number,
  fontScale: number,
): Promise<SystemScreenMetrics> =>
  buildFallbackSystemScreenMetrics(widthDp, heightDp, fontScale);
