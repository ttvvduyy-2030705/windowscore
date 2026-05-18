type ThumbnailOverlayData = {
  enabled: boolean;
  topLeft: string[];
  topRight: string[];
  bottomLeft: string[];
  bottomRight: string[];
};

export type MatchOverlayNativePlayer = {
  name: string;
  flag: string;
  score: number;
  currentPoint: number;
  color: string;
  highestRate: number;
  secondHighestRate: number;
  average: number;
};

export type MatchOverlayNativeModel = {
  visible: boolean;
  variant: 'pool' | 'carom';
  currentPlayerIndex: number;
  countdownTime: number;
  baseCountdown: number;
  goal: number;
  totalTurns: number;
  players: MatchOverlayNativePlayer[];
  thumbnails: ThumbnailOverlayData;
};

const EMPTY_THUMBNAILS: ThumbnailOverlayData = {
  enabled: false,
  topLeft: [],
  topRight: [],
  bottomLeft: [],
  bottomRight: [],
};

export const EMPTY_MATCH_OVERLAY_NATIVE_MODEL: MatchOverlayNativeModel = {
  visible: false,
  variant: 'pool',
  currentPlayerIndex: 0,
  countdownTime: 0,
  baseCountdown: 0,
  goal: 0,
  totalTurns: 1,
  players: [],
  thumbnails: EMPTY_THUMBNAILS,
};

export const buildMatchOverlayModelFromScoreBoardStore = (): MatchOverlayNativeModel => {
  return EMPTY_MATCH_OVERLAY_NATIVE_MODEL;
};

export const buildMatchOverlayNativeModel = buildMatchOverlayModelFromScoreBoardStore;

export const createMatchOverlayModelSignature = (
  model: MatchOverlayNativeModel,
): string => JSON.stringify(model);
