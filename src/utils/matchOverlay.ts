export const MATCH_OVERLAY_COMPETITION_MODE = 'pro';
export const MATCH_OVERLAY_QUICK_COMPETITION_MODE = 'quick_match';

const MATCH_OVERLAY_MODES = new Set([
  MATCH_OVERLAY_COMPETITION_MODE,
  MATCH_OVERLAY_QUICK_COMPETITION_MODE,
]);

const toPositiveFiniteNumber = (value: any): number | undefined => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
};

export const resolveMatchOverlayMode = (gameSettings?: any): string => {
  const rawMode =
    gameSettings?.mode?.mode ??
    gameSettings?.mode ??
    gameSettings?.gameMode ??
    gameSettings?.playMode ??
    gameSettings?.selectedMode;

  return typeof rawMode === 'string' ? rawMode.trim().toLowerCase() : '';
};

export const resolveMatchOverlayPlayerCount = (
  gameSettings?: any,
  playerSettings?: any,
): number | undefined => {
  const candidateValues = [
    playerSettings?.playerNumber,
    gameSettings?.players?.playerNumber,
    gameSettings?.playerNumber,
    Array.isArray(playerSettings?.playingPlayers)
      ? playerSettings.playingPlayers.length
      : undefined,
    Array.isArray(gameSettings?.players?.playingPlayers)
      ? gameSettings.players.playingPlayers.length
      : undefined,
  ];

  for (const candidate of candidateValues) {
    const resolved = toPositiveFiniteNumber(candidate);
    if (resolved !== undefined) {
      return resolved;
    }
  }

  return undefined;
};

export const shouldShowMatchOverlay = (
  gameSettings?: any,
  playerSettings?: any,
): boolean => {
  return (
    MATCH_OVERLAY_MODES.has(resolveMatchOverlayMode(gameSettings)) &&
    resolveMatchOverlayPlayerCount(gameSettings, playerSettings) === 2
  );
};
