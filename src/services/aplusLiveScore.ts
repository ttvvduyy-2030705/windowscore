import DeviceInfo from 'react-native-device-info';
import {
  APLUS_LIVE_SCORE_API_KEY,
  APLUS_LIVE_SCORE_BASE_URL,
  APLUS_LIVE_SCORE_DEVICE_NAME,
  APLUS_LIVE_SCORE_ENDPOINTS,
} from 'config/aplusLiveScore';
import {Player, PlayerSettings} from 'types/player';
import {GameSettings} from 'types/settings';

type HttpMethod = 'GET' | 'POST' | 'PATCH';

export type AplusTournament = {
  id: string;
  name: string;
  raw?: any;
};

export type AplusLiveMatch = {
  id: string;
  matchNumber: string;
  tournamentId: string;
  tournamentName?: string;
  sessionToken?: string;
  lockExpiresAt?: string;
  player1: Partial<Player>;
  player2: Partial<Player>;
  raw?: any;
};

export type AplusLiveScoreConfig = {
  enabled: boolean;
  tournamentId: string;
  tournamentName?: string;
  matchId: string;
  matchNumber: string;
  sessionToken?: string;
  rawMatch?: any;
};

type LiveScorePayload = {
  gameSettings?: GameSettings | any;
  playerSettings?: PlayerSettings;
  totalTurns?: number;
  totalTime?: number;
  currentPlayerIndex?: number;
  winner?: Player | null;
  isStarted?: boolean;
  isPaused?: boolean;
  isMatchPaused?: boolean;
};

const toText = (value?: unknown) => String(value ?? '').trim();
const trimSlash = (value: string) => String(value || '').replace(/\/+$/, '');

const buildUrl = (path: string, params: Record<string, string | number> = {}) => {
  let resolvedPath = path;

  Object.entries(params).forEach(([key, value]) => {
    resolvedPath = resolvedPath.split(`:${key}`).join(encodeURIComponent(String(value)));
  });

  if (/^https?:\/\//i.test(resolvedPath)) {
    return resolvedPath;
  }

  return `${trimSlash(APLUS_LIVE_SCORE_BASE_URL)}${resolvedPath.startsWith('/') ? '' : '/'}${resolvedPath}`;
};

const getDeviceId = async () => {
  try {
    const uniqueId = await DeviceInfo.getUniqueId();
    if (uniqueId) {
      return String(uniqueId);
    }
  } catch (_error) {}

  return 'windows-scoreboard-device';
};

const readJsonSafe = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
};

const requestJson = async (
  method: HttpMethod,
  path: string,
  params: Record<string, string | number> = {},
  body?: any,
  sessionToken?: string,
) => {
  const url = buildUrl(path, params);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-live-api-key': APLUS_LIVE_SCORE_API_KEY,
    'x-aplus-device': APLUS_LIVE_SCORE_DEVICE_NAME,
  };

  if (sessionToken) {
    headers['x-live-session-token'] = sessionToken;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });

  const data = await readJsonSafe(response);

  if (!response.ok) {
    throw new Error(
      typeof data === 'string'
        ? data
        : data?.message || data?.error || `HTTP ${response.status}`,
    );
  }

  return data;
};

const getArrayFromResponse = (data: any): any[] => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.tournaments)) return data.tournaments;
  if (Array.isArray(data?.data?.tournaments)) return data.data.tournaments;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
};

const getObjectFromResponse = (data: any) => data?.match || data?.data?.match || data?.data || data;

const normalizeTournament = (item: any, index: number): AplusTournament => {
  const id = toText(item?._id) || toText(item?.id) || toText(item?.slug) || String(index + 1);
  const name = toText(item?.name) || toText(item?.title) || `Giải ${index + 1}`;
  return {id, name, raw: item};
};

const normalizeCountryCode = (value?: unknown) => {
  const raw = toText(value).toUpperCase();

  if (raw === 'VN' || raw === 'VNM' || raw.includes('VIET') || raw.includes('VIỆT')) return 'VN';
  if (raw === 'KR' || raw === 'KOR' || raw.includes('KOREA') || raw.includes('HÀN')) return 'KR';
  if (raw === 'JP' || raw === 'JPN' || raw.includes('JAPAN') || raw.includes('NHẬT')) return 'JP';
  if (/^[A-Z]{2}$/.test(raw)) return raw;

  return raw.slice(0, 2) || 'VN';
};

const normalizePlayer = (
  playerValue: any,
  countryValue: any,
  fallbackName: string,
): Partial<Player> => {
  const isPlainString = typeof playerValue === 'string' || typeof playerValue === 'number';
  const rawPlayer = isPlainString ? {} : playerValue || {};
  const nested = rawPlayer?.player || rawPlayer?.athlete || rawPlayer?.user || rawPlayer;

  const name =
    (isPlainString ? toText(playerValue) : '') ||
    toText(nested?.name) ||
    toText(nested?.fullName) ||
    toText(nested?.displayName) ||
    toText(rawPlayer?.playerName) ||
    fallbackName;

  const rawCountry =
    countryValue ??
    nested?.countryCode ??
    nested?.country ??
    nested?.nationalityCode ??
    nested?.nationality ??
    rawPlayer?.countryCode ??
    rawPlayer?.country ??
    rawPlayer?.nationality;

  const countryCode = normalizeCountryCode(rawCountry);
  const countryName =
    toText(nested?.countryName) ||
    toText(rawPlayer?.countryName) ||
    toText(rawCountry) ||
    countryCode;

  return {
    name,
    countryCode,
    countryName,
    flag: countryCode,
  };
};

const getMatchPlayers = (match: any) => {
  const players = Array.isArray(match?.players)
    ? match.players
    : Array.isArray(match?.competitors)
    ? match.competitors
    : [];

  return {
    player1: normalizePlayer(
      match?.player1 || match?.playerA || match?.homePlayer || match?.leftPlayer || players[0],
      match?.player1Country || match?.player1CountryCode || match?.player1Nationality,
      'Người chơi 1',
    ),
    player2: normalizePlayer(
      match?.player2 || match?.playerB || match?.awayPlayer || match?.rightPlayer || players[1],
      match?.player2Country || match?.player2CountryCode || match?.player2Nationality,
      'Người chơi 2',
    ),
  };
};

const normalizeMatch = (
  data: any,
  tournament: AplusTournament,
  matchCode: string,
): AplusLiveMatch => {
  const match = getObjectFromResponse(data);
  const {player1, player2} = getMatchPlayers(match);
  const id = toText(match?._id) || toText(match?.id) || toText(match?.matchId);

  return {
    id,
    matchNumber:
      toText(match?.matchCode) ||
      toText(match?.matchNumber) ||
      toText(match?.tableNumber) ||
      toText(match?.order) ||
      matchCode,
    tournamentId:
      toText(match?.tournament) ||
      toText(match?.tournamentId) ||
      toText(match?.tournament?._id) ||
      toText(match?.tournament?.id) ||
      tournament.id,
    tournamentName:
      toText(match?.tournamentName) ||
      toText(match?.tournament?.name) ||
      tournament.name,
    player1,
    player2,
    raw: match,
  };
};

export const fetchAplusTournaments = async (): Promise<AplusTournament[]> => {
  const data = await requestJson('GET', APLUS_LIVE_SCORE_ENDPOINTS.tournaments);
  return getArrayFromResponse(data).map(normalizeTournament);
};

export const fetchAplusMatchByNumber = async (
  tournament: AplusTournament,
  matchNumber: string,
): Promise<AplusLiveMatch> => {
  const safeMatchNumber = toText(matchNumber);
  if (!safeMatchNumber) {
    throw new Error('Bạn chưa nhập số trận.');
  }

  const data = await requestJson(
    'GET',
    APLUS_LIVE_SCORE_ENDPOINTS.matchByCode,
    {
      tournamentId: tournament.id,
      matchCode: safeMatchNumber,
    },
  );

  const match = normalizeMatch(data, tournament, safeMatchNumber);
  if (!match.id) {
    throw new Error('Web trả về trận nhưng thiếu matchId.');
  }

  return match;
};

export const lockAplusLiveScoreMatch = async (
  match: AplusLiveMatch,
): Promise<AplusLiveMatch> => {
  const deviceId = await getDeviceId();
  const appVersion = typeof DeviceInfo.getVersion === 'function'
    ? DeviceInfo.getVersion()
    : '';

  const data = await requestJson(
    'POST',
    APLUS_LIVE_SCORE_ENDPOINTS.claimMatch,
    {matchId: match.id},
    {
      deviceId,
      deviceName: APLUS_LIVE_SCORE_DEVICE_NAME,
      appVersion,
    },
  );

  const claimedMatch = data?.match || match.raw;
  return {
    ...match,
    raw: claimedMatch || match.raw,
    sessionToken: toText(data?.sessionToken),
    lockExpiresAt: toText(data?.lockExpiresAt),
  };
};

const getAplusLiveScoreConfig = (gameSettings?: any): AplusLiveScoreConfig | undefined => {
  const config = gameSettings?.aplusLiveScore;
  if (!config?.enabled || !config?.matchId) {
    return undefined;
  }

  return config as AplusLiveScoreConfig;
};

export const isAplusLiveScoreEnabled = (gameSettings?: any) => {
  return Boolean(getAplusLiveScoreConfig(gameSettings));
};

export const pushAplusLiveScoreUpdate = async ({
  gameSettings,
  playerSettings,
  winner,
  isStarted,
}: LiveScorePayload) => {
  const config = getAplusLiveScoreConfig(gameSettings);

  if (!config || !config.sessionToken || !playerSettings?.playingPlayers?.length) {
    return;
  }

  const players = playerSettings.playingPlayers.slice(0, 2);
  const score1 = Number(players[0]?.totalPoint || 0);
  const score2 = Number(players[1]?.totalPoint || 0);

  await requestJson(
    'PATCH',
    APLUS_LIVE_SCORE_ENDPOINTS.updateScore,
    {matchId: config.matchId},
    {
      score1,
      score2,
      status: winner ? 'finished' : isStarted ? 'playing' : 'upcoming',
      isLive: Boolean(isStarted && !winner),
    },
    config.sessionToken,
  );
};

export const heartbeatAplusLiveScoreMatch = async (config?: AplusLiveScoreConfig) => {
  if (!config?.matchId || !config.sessionToken) {
    return;
  }

  await requestJson(
    'POST',
    APLUS_LIVE_SCORE_ENDPOINTS.heartbeat,
    {matchId: config.matchId},
    {},
    config.sessionToken,
  );
};

export const finishAplusLiveScoreMatch = async (
  config?: AplusLiveScoreConfig,
  score1?: number,
  score2?: number,
) => {
  if (!config?.matchId || !config.sessionToken) {
    return;
  }

  await requestJson(
    'POST',
    APLUS_LIVE_SCORE_ENDPOINTS.finishMatch,
    {matchId: config.matchId},
    {score1, score2},
    config.sessionToken,
  );
};

export const releaseAplusLiveScoreMatch = async (config?: AplusLiveScoreConfig) => {
  if (!config?.matchId || !config.sessionToken) {
    return;
  }

  await requestJson(
    'POST',
    APLUS_LIVE_SCORE_ENDPOINTS.releaseMatch,
    {matchId: config.matchId},
    {},
    config.sessionToken,
  );
};
