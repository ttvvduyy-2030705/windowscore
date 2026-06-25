import AsyncStorage from '@react-native-async-storage/async-storage';
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
  gameType?: 'pool' | 'carom' | 'snooker' | 'libre' | string;
  format?: string;
  bracketStructure?: string;
  raw?: any;
};

export type AplusLiveMatch = {
  id: string;
  matchNumber: string;
  tournamentId: string;
  tournamentName?: string;
  sessionToken?: string;
  lockExpiresAt?: string;
  status?: string;
  liveStatus?: string;
  liveStartedAt?: string;
  isLive?: boolean;
  isFinished?: boolean;
  liveLocked?: boolean;
  liveLockDeviceName?: string;
  gameType?: string;
  format?: string;
  bracketStructure?: string;
  score1?: number;
  score2?: number;
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
  lockExpiresAt?: string;
  rawMatch?: any;
};

type LiveScorePayload = {
  gameSettings?: GameSettings | any;
  playerSettings?: PlayerSettings;
  totalTurns?: number;
  totalTime?: number;
  countdownTime?: number;
  countdownBaseTime?: number;
  targetScore?: number;
  currentPlayerIndex?: number;
  winner?: Player | null;
  isStarted?: boolean;
  isPaused?: boolean;
  isMatchPaused?: boolean;
};

const toText = (value?: unknown) => String(value ?? '').trim();
const trimSlash = (value: string) => String(value || '').replace(/\/+$/, '');

const APLUS_LIVE_SCORE_FALLBACK_BASE_URLS = Array.from(
  new Set([
    APLUS_LIVE_SCORE_BASE_URL,
    'https://aplusbilliards.vn/api/live',
  ].map(value => trimSlash(value)).filter(Boolean)),
);

const buildUrlWithBase = (
  baseUrl: string,
  path: string,
  params: Record<string, string | number> = {},
) => {
  let resolvedPath = path;

  Object.entries(params).forEach(([key, value]) => {
    resolvedPath = resolvedPath.split(`:${key}`).join(encodeURIComponent(String(value)));
  });

  if (/^https?:\/\//i.test(resolvedPath)) {
    return resolvedPath;
  }

  return `${trimSlash(baseUrl)}${resolvedPath.startsWith('/') ? '' : '/'}${resolvedPath}`;
};

const buildUrl = (path: string, params: Record<string, string | number> = {}) =>
  buildUrlWithBase(APLUS_LIVE_SCORE_BASE_URL, path, params);

const appendNoCacheQuery = (url: string) => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_ts=${Date.now()}&fresh=1`;
};

const withAplusLiveScoreTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`${label}_TIMEOUT_${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const isVisibleAplusTournament = (item: any) => {
  const status = toText(item?.status || item?.state).toLowerCase();

  return item?.isActive !== false
    && item?.active !== false
    && item?.deleted !== true
    && item?.isDeleted !== true
    && !toText(item?.deletedAt)
    && status !== 'deleted'
    && status !== 'removed'
    && status !== 'archived';
};

const getTournamentSortTime = (item: any) => {
  const raw =
    item?.updatedAt ||
    item?.createdAt ||
    item?.date ||
    item?.startDate ||
    item?.time ||
    '';

  const time = Date.parse(String(raw));
  return Number.isFinite(time) ? time : 0;
};

const getPlayerNameForPayload = (player: any, fallback: string) =>
  toText(player?.name) ||
  toText(player?.fullName) ||
  toText(player?.displayName) ||
  toText(player?.playerName) ||
  fallback;

const getPlayerCountryForPayload = (player: any) =>
  normalizeCountryCode(
    player?.countryCode ||
    player?.country ||
    player?.countryName ||
    player?.nationality ||
    player?.flag ||
    'VN',
  );

const APLUS_DEVICE_ID_STORAGE_KEY = '@aplus_live_score_device_id_v2';
const APLUS_OUTBOX_STORAGE_KEY = '@aplus_live_score_persistent_outbox_v1';
let cachedAplusDeviceId = '';
let aplusLiveScoreClientSeq = 0;
let aplusLiveScoreOutboxFlushTimer: ReturnType<typeof setTimeout> | undefined;
let aplusLiveScoreOutboxFlushInFlight = false;

type AplusLiveScoreOutboxAction = 'score' | 'finish';
type AplusLiveScoreOutboxEntry = {
  id: string;
  action: AplusLiveScoreOutboxAction;
  matchId: string;
  tournamentId?: string;
  config: AplusLiveScoreConfig;
  payload?: any;
  score1?: number;
  score2?: number;
  sessionToken?: string;
  clientSeq?: number;
  clientTimestamp: string;
  retryCount: number;
  updatedAt: number;
};

const isBadDeviceId = (value?: unknown) => {
  const text = toText(value).toLowerCase();
  return !text || ['unknown', 'undefined', 'null', 'windows-scoreboard-device', 'windows-device'].includes(text);
};

const makeFallbackDeviceId = () => {
  const random = Math.random().toString(36).slice(2, 12);
  return `windows-scoreboard-${Date.now().toString(36)}-${random}`;
};

const persistAplusDeviceId = async (deviceId: string) => {
  const safeDeviceId = toText(deviceId);
  if (!safeDeviceId) return '';
  cachedAplusDeviceId = safeDeviceId;
  try {
    await AsyncStorage.setItem(APLUS_DEVICE_ID_STORAGE_KEY, safeDeviceId);
  } catch (_error) {}
  return safeDeviceId;
};

const getDeviceId = async () => {
  if (!isBadDeviceId(cachedAplusDeviceId)) {
    return cachedAplusDeviceId;
  }

  try {
    const stored = await AsyncStorage.getItem(APLUS_DEVICE_ID_STORAGE_KEY);
    if (!isBadDeviceId(stored)) {
      cachedAplusDeviceId = String(stored);
      return cachedAplusDeviceId;
    }
  } catch (_error) {}

  try {
    const uniqueId = await DeviceInfo.getUniqueId();
    if (!isBadDeviceId(uniqueId)) {
      return persistAplusDeviceId(String(uniqueId));
    }
  } catch (_error) {}

  return persistAplusDeviceId(makeFallbackDeviceId());
};

const nextAplusLiveScoreClientSeq = () => {
  aplusLiveScoreClientSeq = (aplusLiveScoreClientSeq + 1) % Number.MAX_SAFE_INTEGER;
  return aplusLiveScoreClientSeq;
};

const readAplusLiveScoreOutbox = async (): Promise<AplusLiveScoreOutboxEntry[]> => {
  try {
    const raw = await AsyncStorage.getItem(APLUS_OUTBOX_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(item => item?.matchId && item?.action) : [];
  } catch (_error) {
    return [];
  }
};

const writeAplusLiveScoreOutbox = async (items: AplusLiveScoreOutboxEntry[]) => {
  try {
    await AsyncStorage.setItem(APLUS_OUTBOX_STORAGE_KEY, JSON.stringify(items.slice(-100)));
  } catch (_error) {}
};

const makeAplusOutboxId = (action: AplusLiveScoreOutboxAction, matchId: string) => `${action}:${matchId}`;

const removeAplusLiveScoreOutboxEntry = async (id: string) => {
  const items = await readAplusLiveScoreOutbox();
  await writeAplusLiveScoreOutbox(items.filter(item => item.id !== id));
};

const upsertAplusLiveScoreOutboxEntry = async (entry: Omit<AplusLiveScoreOutboxEntry, 'id' | 'retryCount' | 'updatedAt'>) => {
  const id = makeAplusOutboxId(entry.action, entry.matchId);
  const items = await readAplusLiveScoreOutbox();
  const previous = items.find(item => item.id === id);
  const nextEntry: AplusLiveScoreOutboxEntry = {
    ...previous,
    ...entry,
    id,
    retryCount: previous?.retryCount || 0,
    updatedAt: Date.now(),
  };
  await writeAplusLiveScoreOutbox([...items.filter(item => item.id !== id), nextEntry]);
  scheduleAplusLiveScoreOutboxFlush(1500);
};

const scheduleAplusLiveScoreOutboxFlush = (delayMs = 5000) => {
  if (aplusLiveScoreOutboxFlushTimer) clearTimeout(aplusLiveScoreOutboxFlushTimer);
  aplusLiveScoreOutboxFlushTimer = setTimeout(() => {
    aplusLiveScoreOutboxFlushTimer = undefined;
    void flushAplusLiveScoreOutbox('timer');
  }, Math.max(1000, delayMs));
};

type AplusLiveScoreSessionCacheEntry = {
  sessionToken: string;
  lockExpiresAt?: string;
  updatedAt: number;
};

const aplusLiveScoreSessionCache = new Map<string, AplusLiveScoreSessionCacheEntry>();

const rememberAplusLiveScoreSession = (
  matchId?: string,
  sessionToken?: string,
  lockExpiresAt?: string,
) => {
  const safeMatchId = toText(matchId);
  const safeToken = toText(sessionToken);

  if (!safeMatchId || !safeToken) {
    return;
  }

  aplusLiveScoreSessionCache.set(safeMatchId, {
    sessionToken: safeToken,
    lockExpiresAt: toText(lockExpiresAt) || undefined,
    updatedAt: Date.now(),
  });
};

const forgetAplusLiveScoreSession = (matchId?: string) => {
  const safeMatchId = toText(matchId);
  if (safeMatchId) {
    aplusLiveScoreSessionCache.delete(safeMatchId);
  }
};

const getCachedAplusLiveScoreSessionToken = (
  config?: Pick<AplusLiveScoreConfig, 'matchId' | 'sessionToken'>,
) => {
  const safeMatchId = toText(config?.matchId);
  const cachedToken = safeMatchId
    ? toText(aplusLiveScoreSessionCache.get(safeMatchId)?.sessionToken)
    : '';

  return cachedToken || toText(config?.sessionToken);
};

const normalizeErrorMessage = (error: unknown) =>
  String((error as Error)?.message || error || '').toLowerCase();

const isAplusMatchFinishedError = (error: unknown) => {
  const anyError = error as any;
  const message = normalizeErrorMessage(error);

  return (
    anyError?.code === 'MATCH_FINISHED' ||
    message.includes('trận đấu đã kết thúc') ||
    message.includes('tran dau da ket thuc') ||
    message.includes('đã kết thúc') ||
    message.includes('da ket thuc')
  );
};

const isAplusMatchLockedError = (error: unknown) => {
  const anyError = error as any;
  const message = normalizeErrorMessage(error);

  return (
    anyError?.code === 'MATCH_LOCKED' ||
    anyError?.status === 423 ||
    message.includes('trận đấu đang diễn ra') ||
    message.includes('tran dau dang dien ra') ||
    message.includes('đang diễn ra trên') ||
    message.includes('dang dien ra tren') ||
    message.includes('máy khác') ||
    message.includes('may khac')
  );
};

const isAplusLiveScoreClaimBlockError = (error: unknown) =>
  isAplusMatchFinishedError(error) || isAplusMatchLockedError(error);

const isLiveSessionTokenError = (error: unknown) => {
  if (isAplusLiveScoreClaimBlockError(error)) {
    return false;
  }

  const message = normalizeErrorMessage(error);

  return (
    message.includes('session') ||
    message.includes('token') ||
    message.includes('phiên') ||
    message.includes('phien') ||
    message.includes('thiếu live session') ||
    message.includes('thieu live session') ||
    message.includes('hết hạn') ||
    message.includes('het han') ||
    message.includes('expired')
  );
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
  const deviceId = await getDeviceId();
  const requestSeq = method === 'GET' ? undefined : nextAplusLiveScoreClientSeq();
  const requestBody = method === 'GET'
    ? undefined
    : {
        ...(body && typeof body === 'object' ? body : {}),
        deviceId: toText(body?.deviceId) || deviceId,
        deviceName: toText(body?.deviceName) || APLUS_LIVE_SCORE_DEVICE_NAME,
        clientTimestamp: toText(body?.clientTimestamp) || new Date().toISOString(),
        clientSeq: body?.clientSeq ?? requestSeq,
      };

  const urls = APLUS_LIVE_SCORE_FALLBACK_BASE_URLS.map(baseUrl => {
    const built = buildUrlWithBase(baseUrl, path, params);
    return method === 'GET' ? appendNoCacheQuery(built) : built;
  });

  let lastNetworkError: unknown = null;

  for (const url of urls) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-live-api-key': APLUS_LIVE_SCORE_API_KEY,
      'x-aplus-device': APLUS_LIVE_SCORE_DEVICE_NAME,
      'x-aplus-device-name': APLUS_LIVE_SCORE_DEVICE_NAME,
      'x-aplus-device-id': deviceId,
    };

    if (sessionToken) {
      headers['x-live-session-token'] = sessionToken;
    }

    const shouldLogHttp = method !== 'PATCH' || !url.includes('/score');
    if (shouldLogHttp) {
      console.log('[AplusLiveScore][HTTP_START]', {
        method,
        url,
        hasSessionToken: Boolean(sessionToken),
        body: method === 'GET' ? undefined : requestBody,
      });
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(requestBody ?? {}),
      });
    } catch (error) {
      lastNetworkError = error;
      console.log('[AplusLiveScore][NETWORK_ERROR]', {
        method,
        url,
        message: String((error as Error)?.message || error),
      });

      if (url !== urls[urls.length - 1]) {
        continue;
      }

      throw error;
    }

    const data = await readJsonSafe(response);

    if (!response.ok) {
      console.log('[AplusLiveScore][HTTP_ERROR]', {
        method,
        url,
        status: response.status,
        data,
      });

      const message = typeof data === 'string'
        ? data
        : data?.message || data?.error || `HTTP ${response.status}`;
      const error = new Error(message);
      (error as any).status = response.status;
      (error as any).code = typeof data === 'string' ? undefined : data?.code;
      (error as any).data = data;
      throw error;
    }

    if (shouldLogHttp) {
      console.log('[AplusLiveScore][HTTP_OK]', {
        method,
        url,
        status: response.status,
        data,
      });
    }

    return data;
  }

  throw lastNetworkError || new Error('Không kết nối được Live API.');
};

const claimAplusLiveScoreSession = async (
  config: Pick<AplusLiveScoreConfig, 'matchId' | 'lockExpiresAt'>,
) => {
  const matchId = toText(config?.matchId);

  if (!matchId) {
    throw new Error('Thiếu matchId để claim phiên live score.');
  }

  const deviceId = await getDeviceId();
  const appVersion = typeof DeviceInfo.getVersion === 'function'
    ? DeviceInfo.getVersion()
    : '';

  console.log('[AplusLiveScore][CLAIM_SESSION_START]', {matchId, deviceId});

  const data = await requestJson(
    'POST',
    APLUS_LIVE_SCORE_ENDPOINTS.claimMatch,
    {matchId},
    {
      deviceId,
      deviceName: APLUS_LIVE_SCORE_DEVICE_NAME,
      appVersion,
    },
  );

  const sessionToken = toText(data?.sessionToken);
  const lockExpiresAt = toText(data?.lockExpiresAt) || toText(config?.lockExpiresAt);

  if (!sessionToken) {
    throw new Error('Live API claim thành công nhưng thiếu sessionToken.');
  }

  rememberAplusLiveScoreSession(matchId, sessionToken, lockExpiresAt);

  console.log('[AplusLiveScore][CLAIM_SESSION_OK]', {
    matchId,
    hasSessionToken: true,
    lockExpiresAt,
  });

  return {
    sessionToken,
    lockExpiresAt,
    rawMatch: data?.match,
  };
};

const getOrClaimAplusLiveScoreSessionToken = async (
  config: AplusLiveScoreConfig,
) => {
  const cachedToken = getCachedAplusLiveScoreSessionToken(config);
  if (cachedToken) {
    return cachedToken;
  }

  const claimed = await claimAplusLiveScoreSession(config);
  return claimed.sessionToken;
};

export const flushAplusLiveScoreOutbox = async (reason = 'manual') => {
  if (aplusLiveScoreOutboxFlushInFlight) return;
  aplusLiveScoreOutboxFlushInFlight = true;

  try {
    const items = await readAplusLiveScoreOutbox();
    if (!items.length) return;

    const remaining: AplusLiveScoreOutboxEntry[] = [];

    for (const item of items) {
      try {
        const config = item.config || ({ matchId: item.matchId, tournamentId: item.tournamentId } as AplusLiveScoreConfig);
        let sessionToken = toText(item.sessionToken) || getCachedAplusLiveScoreSessionToken(config);
        if (!sessionToken) {
          sessionToken = await getOrClaimAplusLiveScoreSessionToken(config);
        }

        if (item.action === 'finish') {
          await requestJson(
            'POST',
            APLUS_LIVE_SCORE_ENDPOINTS.finishMatch,
            {matchId: item.matchId},
            {
              score1: item.score1,
              score2: item.score2,
              tournamentId: item.tournamentId || config.tournamentId,
              clientSeq: item.clientSeq,
              clientTimestamp: item.clientTimestamp,
            },
            sessionToken,
          );
          forgetAplusLiveScoreSession(item.matchId);
          startedAplusLiveScoreMatchIds.delete(item.matchId);
          startingAplusLiveScoreMatchPromises.delete(item.matchId);
        } else {
          await requestJson(
            'PATCH',
            APLUS_LIVE_SCORE_ENDPOINTS.updateScore,
            {matchId: item.matchId},
            {
              ...(item.payload || {}),
              tournamentId: item.tournamentId || config.tournamentId,
              clientSeq: item.clientSeq,
              clientTimestamp: item.clientTimestamp,
            },
            sessionToken,
          );
        }
      } catch (error) {
        if (isAplusMatchFinishedError(error) || isAplusMatchLockedError(error)) {
          console.log('[AplusLiveScore][OUTBOX_DROP_LOCKED_OR_FINISHED]', {
            reason,
            action: item.action,
            matchId: item.matchId,
            message: (error as Error)?.message || error,
          });
          continue;
        }

        remaining.push({
          ...item,
          sessionToken: isLiveSessionTokenError(error) ? '' : item.sessionToken,
          retryCount: (item.retryCount || 0) + 1,
          updatedAt: Date.now(),
        });
      }
    }

    await writeAplusLiveScoreOutbox(remaining);
    if (remaining.length) {
      const maxRetry = Math.max(...remaining.map(item => item.retryCount || 0));
      scheduleAplusLiveScoreOutboxFlush(Math.min(60000, 3000 * (2 ** Math.min(maxRetry, 4))));
    }
  } finally {
    aplusLiveScoreOutboxFlushInFlight = false;
  }
};


// APLUS_MATCH_CODE_LOOKUP_START
export const normalizeAplusMatchCode = (input?: unknown): string | null => {
  if (input === undefined || input === null) {
    return null;
  }

  const raw = String(input).trim().toUpperCase().replace(/\s+/g, '');

  if (/^T\d+$/.test(raw)) {
    const number = Number(raw.slice(1));
    return Number.isFinite(number) && number > 0 ? `T${number}` : null;
  }

  if (/^\d+$/.test(raw)) {
    const number = Number(raw);
    return Number.isFinite(number) && number > 0 ? `T${number}` : null;
  }

  return null;
};

const getAplusMatchCodeCandidates = (match: any): unknown[] => [
  match?.code,
  match?.matchCode,
  match?.matchNumber,
  match?.number,
  match?.name,
  match?.title,
  match?.label,
  match?.raw?.code,
  match?.raw?.matchCode,
  match?.raw?.matchNumber,
  match?.raw?.number,
  match?.raw?.name,
  match?.raw?.title,
  match?.raw?.label,
];

export const findAplusMatchByCode = <T extends any>(
  matches: T[] = [],
  input?: unknown,
): T | null => {
  const normalizedCode = normalizeAplusMatchCode(input);

  if (!normalizedCode) {
    return null;
  }

  return (
    matches.find(match =>
      getAplusMatchCodeCandidates(match).some(
        candidate => normalizeAplusMatchCode(candidate) === normalizedCode,
      ),
    ) || null
  );
};
// APLUS_MATCH_CODE_LOOKUP_END


const getArrayFromResponse = (data: any): any[] => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.tournaments)) return data.tournaments;
  if (Array.isArray(data?.data?.tournaments)) return data.data.tournaments;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
};

const getObjectFromResponse = (data: any) => data?.match || data?.data?.match || data?.data || data;


const isFinishedAplusMatchStatus = (value?: unknown) => {
  const status = toText(value).toLowerCase();
  return [
    'finished',
    'completed',
    'complete',
    'ended',
    'done',
    'closed',
    'cancelled',
    'canceled',
    'walkover',
    'forfeit',
  ].includes(status);
};

const isFinishedAplusMatchRaw = (match: any) =>
  Boolean(
    match?.isFinished ||
      match?.finishedAt ||
      match?.endedAt ||
      match?.completedAt ||
      isFinishedAplusMatchStatus(match?.status) ||
      isFinishedAplusMatchStatus(match?.liveStatus) ||
      isFinishedAplusMatchStatus(match?.matchStatus),
  );


const normalizeTournamentGameType = (value?: unknown) => {
  const raw = toText(value).toLowerCase();

  if (!raw) return '';
  if (raw.includes('snooker')) return 'snooker';
  if (raw.includes('libre') || raw.includes('free')) return 'libre';
  if (raw.includes('carom') || raw.includes('carambole') || raw.includes('3c') || raw.includes('3-cushion') || raw.includes('3 cushion')) return 'carom';
  if (raw.includes('pool') || raw.includes('9-ball') || raw.includes('10-ball') || raw.includes('8-ball')) return 'pool';

  if (raw === 'snooker' || raw === 'libre' || raw === 'carom' || raw === 'pool') return raw;
  return raw;
};

const normalizeTournament = (item: any, index: number): AplusTournament => {
  const id = toText(item?._id) || toText(item?.id) || toText(item?.slug) || String(index + 1);
  const name = toText(item?.name) || toText(item?.title) || `Giải ${index + 1}`;
  const gameType = normalizeTournamentGameType(
    item?.gameType ||
      item?.type ||
      item?.gameMode ||
      item?.category ||
      item?.discipline,
  );

  const format = toText(item?.format || item?.rule || item?.tournamentFormat);
  const bracketStructure = toText(item?.bracketStructure || item?.bracket_structure || item?.bracketConfig?.structure || item?.bracketConfig?.bracketStructure);

  return {id, name, gameType, format, bracketStructure, raw: item};
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

const getMatchListFromResponse = (data: any): any[] => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.matches)) return data.matches;
  if (Array.isArray(data?.data?.matches)) return data.data.matches;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
};

const waitAplusLiveScore = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

const getTournamentIdentityCandidates = (tournament: AplusTournament) => {
  const raw = tournament?.raw || {};

  return Array.from(
    new Set(
      [
        tournament?.id,
        tournament?.name,
        raw?._id,
        raw?.id,
        raw?.tournamentId,
        raw?.slug,
        raw?.name,
        raw?.title,
      ]
        .map(value => toText(value).toLowerCase())
        .filter(Boolean),
    ),
  );
};

const findSameTournamentFromFreshList = (
  tournament: AplusTournament,
  freshTournaments: AplusTournament[],
) => {
  const identities = new Set(getTournamentIdentityCandidates(tournament));

  return freshTournaments.find(item => {
    const raw = item?.raw || {};
    const candidates = [
      item?.id,
      item?.name,
      raw?._id,
      raw?.id,
      raw?.tournamentId,
      raw?.slug,
      raw?.name,
      raw?.title,
    ]
      .map(value => toText(value).toLowerCase())
      .filter(Boolean);

    return candidates.some(value => identities.has(value));
  });
};


const normalizeAplusMatchCodeVariants = (input: string) => {
  const raw = toText(input).toUpperCase().replace(/\s+/g, '');
  const digits = raw.match(/\d+/)?.[0] || '';

  const variants = [
    raw,
    digits ? `T${Number(digits)}` : '',
    digits ? `T${digits.padStart(2, '0')}` : '',
    digits ? `${Number(digits)}` : '',
    digits ? digits.padStart(2, '0') : '',
  ]
    .map(value => toText(value).toUpperCase())
    .filter(Boolean);

  return Array.from(new Set(variants));
};

const getMatchCodeCandidatesFromRaw = (match: any) => {
  const values = [
    match?.matchCode,
    match?.matchNumber,
    match?.tableNumber,
    match?.code,
    match?.order,
  ]
    .map(value => toText(value).toUpperCase().replace(/\s+/g, ''))
    .filter(Boolean);

  return Array.from(new Set(values));
};

const findMatchInListByCode = (matches: any[], variants: string[]) => {
  const normalizedVariants = new Set(
    variants.map(value => toText(value).toUpperCase().replace(/\s+/g, '')),
  );

  return matches.find(match => {
    const candidates = getMatchCodeCandidatesFromRaw(match);
    return candidates.some(candidate => normalizedVariants.has(candidate));
  });
};


const fetchFreshMatchListForTournament = async (tournament: AplusTournament) => {
  // Dùng query chống cache mạnh hơn vì trận mới tạo thường bị backend/live API sync chậm.
  const path =
    `/tournaments/${encodeURIComponent(tournament.id)}/matches` +
    `?page=1&limit=500&perPage=500&pageSize=500&fresh=1&force=1&sync=1&_matchTs=${Date.now()}`;

  const data = await requestJson('GET', path);
  return getMatchListFromResponse(data);
};

const refreshTournamentBeforeMatchLookup = async (tournament: AplusTournament) => {
  try {
    const freshTournaments = await fetchAplusTournaments();
    const freshTournament = findSameTournamentFromFreshList(tournament, freshTournaments);

    if (freshTournament?.id && freshTournament.id !== tournament.id) {
      console.log('[AplusLiveScore][MATCH_LOOKUP_TOURNAMENT_ID_REFRESHED]', {
        oldTournamentId: tournament.id,
        newTournamentId: freshTournament.id,
        tournamentName: freshTournament.name,
      });
      return freshTournament;
    }
  } catch (error: any) {
    console.log('[AplusLiveScore][MATCH_LOOKUP_TOURNAMENT_REFRESH_FAILED]', {
      tournamentId: tournament.id,
      message: error?.message || String(error),
    });
  }

  return tournament;
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
    status: toText(match?.status),
    isLive: Boolean(match?.isLive),
    isFinished: isFinishedAplusMatchRaw(match),
    liveLocked: Boolean(match?.liveLocked),
    liveLockDeviceName: toText(match?.liveLockDeviceName || match?.liveDeviceName),
    gameType: normalizeTournamentGameType(
      match?.gameType ||
        match?.tournament?.gameType ||
        match?.tournamentGameType ||
        tournament.gameType ||
        tournament.raw?.gameType ||
        tournament.raw?.category ||
        tournament.raw?.type,
    ),
    format: toText(match?.format || match?.tournament?.format || tournament.format || tournament.raw?.format),
    bracketStructure: toText(match?.bracketStructure || match?.tournament?.bracketStructure || tournament.bracketStructure || tournament.raw?.bracketStructure || tournament.raw?.bracket_structure),
    score1: Number(match?.score1 ?? match?.player1Score ?? match?.p1Score ?? 0),
    score2: Number(match?.score2 ?? match?.player2Score ?? match?.p2Score ?? 0),
    player1,
    player2,
    raw: match,
  };
};

const normalizeLiveMatch = (match: any, tournament: AplusTournament): AplusLiveMatch => {
  const code =
    toText(match?.matchCode) ||
    toText(match?.matchNumber) ||
    toText(match?.tableNumber) ||
    toText(match?.code) ||
    toText(match?.order);

  return normalizeMatch(match, tournament, normalizeAplusMatchCode(code) || code || '');
};

export const fetchAplusTournaments = async (): Promise<AplusTournament[]> => {
  const data = await requestJson('GET', APLUS_LIVE_SCORE_ENDPOINTS.tournaments);
  return getArrayFromResponse(data)
    .filter(isVisibleAplusTournament)
    .sort((a, b) => getTournamentSortTime(b) - getTournamentSortTime(a))
    .map(normalizeTournament)
    .filter(tournament => Boolean(tournament.id && tournament.name));
};

const isAplusLiveScoreAuthError = (error: unknown) => {
  const message = String((error as Error)?.message || error || '').toLowerCase();

  return (
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('live api key') ||
    message.includes('api key') ||
    message.includes('không có quyền') ||
    message.includes('khong co quyen') ||
    message.includes('không hợp lệ') ||
    message.includes('khong hop le')
  );
};

export const fetchAplusMatchByNumber = async (
  tournament: AplusTournament,
  matchNumber: string | number,
): Promise<AplusLiveMatch | null> => {
  const normalizedCode = normalizeAplusMatchCode(matchNumber);

  if (!normalizedCode) {
    throw new Error('Mã trận không hợp lệ. Nhập dạng T5 hoặc 5.');
  }

  const freshTournament = await refreshTournamentBeforeMatchLookup(tournament);
  const rawMatches = await fetchFreshMatchListForTournament(freshTournament);

  const normalizedMatches = rawMatches
    .map(match => {
      try {
        return normalizeLiveMatch(match, freshTournament);
      } catch (_error) {
        return match as AplusLiveMatch;
      }
    })
    .filter(Boolean);

  const match = findAplusMatchByCode(normalizedMatches, normalizedCode);

  if (!match) {
    return null;
  }

  return match;
};

export const lockAplusLiveScoreMatch = async (
  match: AplusLiveMatch,
): Promise<AplusLiveMatch> => {
  if (match?.isFinished || isFinishedAplusMatchRaw(match?.raw)) {
    forgetAplusLiveScoreSession(match.id);
    throw new Error(`Trận ${match.matchNumber || ''} đã kết thúc rồi, không thể vào lại.`.trim());
  }

  const deviceId = await getDeviceId();
  const appVersion = typeof DeviceInfo.getVersion === 'function'
    ? DeviceInfo.getVersion()
    : '';

  let data: any;

  try {
    data = await requestJson(
      'POST',
      APLUS_LIVE_SCORE_ENDPOINTS.claimMatch,
      {matchId: match.id},
      {
        deviceId,
        deviceName: APLUS_LIVE_SCORE_DEVICE_NAME,
        appVersion,
      },
    );
  } catch (error: any) {
    if (isAplusMatchFinishedError(error)) {
      forgetAplusLiveScoreSession(match.id);
      throw new Error(`Trận ${match.matchNumber || ''} đã kết thúc rồi, không thể vào lại.`.trim());
    }

    if (isAplusMatchLockedError(error)) {
      const message = error?.message || `Trận ${match.matchNumber || ''} đang diễn ra trên máy khác.`;
      throw new Error(message);
    }

    throw error;
  }

  const claimedMatch = data?.match || match.raw;
  const sessionToken = toText(data?.sessionToken);
  const lockExpiresAt = toText(data?.lockExpiresAt);

  rememberAplusLiveScoreSession(match.id, sessionToken, lockExpiresAt);

  return {
    ...match,
    raw: claimedMatch || match.raw,
    sessionToken,
    lockExpiresAt,
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

export const startAplusLiveScoreMatch = async (config?: AplusLiveScoreConfig) => {
  if (!config?.matchId) {
    return null;
  }

  let sessionToken = '';

  try {
    sessionToken = await getOrClaimAplusLiveScoreSessionToken(config);
  } catch (error) {
    if (isAplusLiveScoreClaimBlockError(error)) {
      forgetAplusLiveScoreSession(config.matchId);
      throw error;
    }
    throw error;
  }

  const deviceId = await getDeviceId();
  const result = await requestJson(
    'POST',
    APLUS_LIVE_SCORE_ENDPOINTS.startMatch,
    {matchId: config.matchId},
    {
      deviceId,
      deviceName: APLUS_LIVE_SCORE_DEVICE_NAME,
    },
    sessionToken,
  );

  const lockExpiresAt = toText(result?.lockExpiresAt || config.lockExpiresAt);
  if (lockExpiresAt) {
    config.lockExpiresAt = lockExpiresAt;
    rememberAplusLiveScoreSession(config.matchId, sessionToken, lockExpiresAt);
  }

  if (result?.match) {
    config.rawMatch = result.match;
  }

  return result?.match || null;
};

const startedAplusLiveScoreMatchIds = new Set<string>();
const startingAplusLiveScoreMatchPromises = new Map<string, Promise<void>>();

const APLUS_SCORE_MIN_PUSH_INTERVAL_MS = 350;
type AplusQueuedScoreTask = {
  run: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: unknown) => void;
};
type AplusScoreQueueEntry = {
  inFlight: boolean;
  pending?: AplusQueuedScoreTask;
  lastSentAt: number;
  drainTimer?: ReturnType<typeof setTimeout>;
};
const aplusLiveScoreQueues = new Map<string, AplusScoreQueueEntry>();

const waitAplusScoreQueue = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const drainAplusLiveScoreQueue = async (matchId: string) => {
  const entry = aplusLiveScoreQueues.get(matchId);
  if (!entry || entry.inFlight) return;

  const next = entry.pending;
  if (!next) {
    if (!entry.drainTimer) aplusLiveScoreQueues.delete(matchId);
    return;
  }

  entry.pending = undefined;
  entry.inFlight = true;
  try {
    const delay = Math.max(0, APLUS_SCORE_MIN_PUSH_INTERVAL_MS - (Date.now() - entry.lastSentAt));
    if (delay > 0) await waitAplusScoreQueue(delay);
    const result = await next.run();
    entry.lastSentAt = Date.now();
    next.resolve(result);
  } catch (error) {
    next.reject(error);
  } finally {
    entry.inFlight = false;
    if (entry.pending) {
      if (entry.drainTimer) clearTimeout(entry.drainTimer);
      entry.drainTimer = setTimeout(() => {
        entry.drainTimer = undefined;
        void drainAplusLiveScoreQueue(matchId);
      }, APLUS_SCORE_MIN_PUSH_INTERVAL_MS);
    } else {
      aplusLiveScoreQueues.delete(matchId);
    }
  }
};

const enqueueLatestAplusLiveScoreWrite = (matchId: string, run: () => Promise<any>) => {
  const key = toText(matchId);
  if (!key) return run();

  let entry = aplusLiveScoreQueues.get(key);
  if (!entry) {
    entry = { inFlight: false, lastSentAt: 0 };
    aplusLiveScoreQueues.set(key, entry);
  }

  if (entry.pending) {
    entry.pending.resolve({ success: true, skipped: true, replacedByNewerSnapshot: true });
  }

  const promise = new Promise((resolve, reject) => {
    entry!.pending = { run, resolve, reject };
  });

  void drainAplusLiveScoreQueue(key);
  return promise;
};

const ensureAplusLiveScoreStartedFromGameplay = async (config?: AplusLiveScoreConfig) => {
  if (!config?.matchId) {
    return;
  }

  if (startedAplusLiveScoreMatchIds.has(config.matchId)) {
    return;
  }

  const pending = startingAplusLiveScoreMatchPromises.get(config.matchId);
  if (pending) {
    await pending;
    return;
  }

  const promise = startAplusLiveScoreMatch(config)
    .then(match => {
      const liveStatus = toText(match?.liveStatus).toLowerCase();
      const status = toText(match?.status).toLowerCase();
      if (match?.isLive === true || liveStatus === 'running' || status === 'playing') {
        startedAplusLiveScoreMatchIds.add(config.matchId);
      }
    })
    .finally(() => {
      startingAplusLiveScoreMatchPromises.delete(config.matchId);
    });

  startingAplusLiveScoreMatchPromises.set(config.matchId, promise);
  await promise;
};

export const pushAplusLiveScoreUpdate = async ({
  gameSettings,
  playerSettings,
  totalTurns,
  totalTime,
  countdownTime,
  countdownBaseTime,
  targetScore,
  currentPlayerIndex,
  winner,
  isStarted,
  isPaused,
  isMatchPaused,
}: LiveScorePayload) => {
  const config = getAplusLiveScoreConfig(gameSettings);

  if (!config) {
    console.log('[AplusLiveScore][PUSH_BLOCKED_NO_CONFIG]', {
      hasAplusLiveScore: Boolean((gameSettings as any)?.aplusLiveScore),
      aplusLiveScore: (gameSettings as any)?.aplusLiveScore,
    });
    return;
  }

  if (!playerSettings?.playingPlayers?.length) {
    console.log('[AplusLiveScore][PUSH_BLOCKED_NO_PLAYERS]', {
      matchId: config.matchId,
      playingPlayersLength: playerSettings?.playingPlayers?.length,
    });
    return;
  }

  if (!isStarted) {
    return;
  }

  if (winner) {
    // Kết thúc trận chỉ được gửi qua /finish. Không gửi snapshot finished qua /score,
    // vì request score cũ có thể kéo admin/web về trạng thái sai sau khi đã khóa kết quả.
    console.log('[AplusLiveScore][PUSH_SCORE_SKIP_WINNER_USE_FINISH]', {
      matchId: config.matchId,
      matchNumber: config.matchNumber,
    });
    return;
  }

  const shouldStartLiveFromGameplay = Boolean(isStarted && !winner);
  if (shouldStartLiveFromGameplay) {
    try {
      await ensureAplusLiveScoreStartedFromGameplay(config);
    } catch (error) {
      console.log('[AplusLiveScore][START_FROM_GAMEPLAY_FAILED]', {
        matchId: config.matchId,
        reason: (error as Error)?.message || error,
      });
      throw error;
    }
  }

  const players = playerSettings.playingPlayers.slice(0, 2);
  const score1 = Number(players[0]?.totalPoint || 0);
  const score2 = Number(players[1]?.totalPoint || 0);
  const resolvedCountdownTime = Math.max(0, Math.round(Number(countdownTime ?? 0)));
  const resolvedCountdownBaseTime = Math.max(
    resolvedCountdownTime,
    Math.round(
      Number(
        countdownBaseTime ??
          (gameSettings as any)?.mode?.countdownTime ??
          (gameSettings as any)?.countdownTime ??
          resolvedCountdownTime ??
          0,
      ),
    ),
  );

  const targetScoreRaw =
    targetScore ??
    (gameSettings as any)?.players?.goal?.goal ??
    (gameSettings as any)?.goal ??
    (gameSettings as any)?.targetScore ??
    (playerSettings as any)?.goal ??
    (playerSettings as any)?.targetScore ??
    0;
  const resolvedTargetScore = Math.round(Number(targetScoreRaw || 0));
  const resolvedTurnCount = Math.max(0, Math.round(Number(totalTurns ?? 0)));
  const liveCountdownIsRunning = Boolean(isStarted && !isPaused && !isMatchPaused && !winner);

  const payload = {
    score1,
    score2,
    // Score updates are action/snapshot-only. Player names, bracket slots and finished status
    // stay DB/admin-owned; /finish is the only API that may end a match.
    liveStatus: 'running',
    isLive: true,

    turnCount: resolvedTurnCount,
    liveTurnCount: resolvedTurnCount,
    totalTurns: resolvedTurnCount,
    totalTime: Math.max(0, Math.round(Number(totalTime ?? 0))),
    currentPlayerIndex: Number.isFinite(Number(currentPlayerIndex))
      ? Number(currentPlayerIndex)
      : undefined,

    targetScore: resolvedTargetScore > 0 ? resolvedTargetScore : undefined,
    liveTargetScore: resolvedTargetScore > 0 ? resolvedTargetScore : undefined,
    goal: resolvedTargetScore > 0 ? resolvedTargetScore : undefined,
    raceTo: resolvedTargetScore > 0 ? resolvedTargetScore : undefined,

    countdownTime: resolvedCountdownTime,
    countdownBaseTime: resolvedCountdownBaseTime,
    countdownIsRunning: liveCountdownIsRunning,
    countdownStatus: liveCountdownIsRunning ? 'running' : 'paused',
    countdownUpdatedAt: new Date().toISOString(),
    liveCountdownTime: resolvedCountdownTime,
    liveCountdownBaseTime: resolvedCountdownBaseTime,
    liveCountdownIsRunning,
    liveCountdownStatus: liveCountdownIsRunning ? 'running' : 'paused',
    liveCountdownUpdatedAt: new Date().toISOString(),
  };

  console.log('[AplusLiveScore][PUSH_SCORE_START]', {
    matchId: config.matchId,
    matchNumber: config.matchNumber,
    tournamentId: config.tournamentId,
    score1,
    score2,
    liveStatus: payload.liveStatus,
  });

  const sendNow = async () => {
    const sendScore = (sessionToken: string) =>
      requestJson(
        'PATCH',
        APLUS_LIVE_SCORE_ENDPOINTS.updateScore,
        {matchId: config.matchId},
        payload,
        sessionToken,
      );

    let sessionToken = '';

    try {
      sessionToken = await getOrClaimAplusLiveScoreSessionToken(config);
    } catch (error) {
      if (isAplusLiveScoreClaimBlockError(error)) {
        console.log('[AplusLiveScore][PUSH_SCORE_BLOCKED_BEFORE_SEND]', {
          matchId: config.matchId,
          reason: (error as Error)?.message || error,
        });
        forgetAplusLiveScoreSession(config.matchId);
        return;
      }
      throw error;
    }

    try {
      const result = await sendScore(sessionToken);
      rememberAplusLiveScoreSession(config.matchId, sessionToken, config.lockExpiresAt);
      await removeAplusLiveScoreOutboxEntry(makeAplusOutboxId('score', config.matchId));
      void flushAplusLiveScoreOutbox('score-ok');

      console.log('[AplusLiveScore][PUSH_SCORE_OK]', {
        matchId: config.matchId,
        score1,
        score2,
        source: result?.source,
      });
      return result;
    } catch (error) {
      if (isAplusLiveScoreClaimBlockError(error)) {
        console.log('[AplusLiveScore][PUSH_SCORE_BLOCKED_BY_MATCH_STATE]', {
          matchId: config.matchId,
          reason: (error as Error)?.message || error,
        });
        forgetAplusLiveScoreSession(config.matchId);
        return;
      }

      if (!isLiveSessionTokenError(error)) {
        throw error;
      }

      console.log('[AplusLiveScore][PUSH_SCORE_RECLAIM]', {
        matchId: config.matchId,
        reason: (error as Error)?.message || error,
      });

      forgetAplusLiveScoreSession(config.matchId);
      const claimed = await claimAplusLiveScoreSession(config);
      sessionToken = claimed.sessionToken;

      const result = await sendScore(sessionToken);
      rememberAplusLiveScoreSession(config.matchId, sessionToken, claimed.lockExpiresAt);
      await removeAplusLiveScoreOutboxEntry(makeAplusOutboxId('score', config.matchId));
      void flushAplusLiveScoreOutbox('score-ok-after-reclaim');

      console.log('[AplusLiveScore][PUSH_SCORE_OK_AFTER_RECLAIM]', {
        matchId: config.matchId,
        result,
      });
      return result;
    }
  };

  return enqueueLatestAplusLiveScoreWrite(config.matchId, async () => {
    try {
      return await sendNow();
    } catch (error) {
      if (!isAplusLiveScoreClaimBlockError(error)) {
        await upsertAplusLiveScoreOutboxEntry({
          action: 'score',
          matchId: config.matchId,
          tournamentId: config.tournamentId,
          config,
          payload,
          sessionToken: getCachedAplusLiveScoreSessionToken(config),
          clientSeq: nextAplusLiveScoreClientSeq(),
          clientTimestamp: new Date().toISOString(),
        });
      }
      throw error;
    }
  });
};

export const heartbeatAplusLiveScoreMatch = async (config?: AplusLiveScoreConfig) => {
  if (!config?.matchId) {
    return;
  }

  const sendHeartbeat = (sessionToken: string) =>
    requestJson(
      'POST',
      APLUS_LIVE_SCORE_ENDPOINTS.heartbeat,
      {matchId: config.matchId},
      {},
      sessionToken,
    );

  let sessionToken = '';

  try {
    sessionToken = await getOrClaimAplusLiveScoreSessionToken(config);
  } catch (error) {
    if (isAplusLiveScoreClaimBlockError(error)) {
      console.log('[AplusLiveScore][HEARTBEAT_BLOCKED_BEFORE_SEND]', {
        matchId: config.matchId,
        reason: (error as Error)?.message || error,
      });
      forgetAplusLiveScoreSession(config.matchId);
      return;
    }
    throw error;
  }

  try {
    await sendHeartbeat(sessionToken);
    rememberAplusLiveScoreSession(config.matchId, sessionToken, config.lockExpiresAt);
    void flushAplusLiveScoreOutbox('heartbeat-ok');
  } catch (error) {
    if (isAplusLiveScoreClaimBlockError(error)) {
      console.log('[AplusLiveScore][PUSH_SCORE_BLOCKED_BY_MATCH_STATE]', {
        matchId: config.matchId,
        reason: (error as Error)?.message || error,
      });
      forgetAplusLiveScoreSession(config.matchId);
      return;
    }

    if (!isLiveSessionTokenError(error)) {
      throw error;
    }

    console.log('[AplusLiveScore][HEARTBEAT_RECLAIM]', {
      matchId: config.matchId,
      reason: (error as Error)?.message || error,
    });

    forgetAplusLiveScoreSession(config.matchId);
    const claimed = await claimAplusLiveScoreSession(config);
    sessionToken = claimed.sessionToken;
    await sendHeartbeat(sessionToken);
    rememberAplusLiveScoreSession(config.matchId, sessionToken, claimed.lockExpiresAt);
  }
};

export const finishAplusLiveScoreMatch = async (
  config?: AplusLiveScoreConfig,
  score1?: number,
  score2?: number,
  options: {timeoutMs?: number; fast?: boolean} = {},
) => {
  if (!config?.matchId) {
    return;
  }

  const timeoutMs = Math.max(500, Number(options.timeoutMs || 3000));
  let sessionToken = getCachedAplusLiveScoreSessionToken(config);
  const finishClientSeq = nextAplusLiveScoreClientSeq();
  const finishClientTimestamp = new Date().toISOString();

  try {
    if (!sessionToken) {
      sessionToken = await withAplusLiveScoreTimeout(
        getOrClaimAplusLiveScoreSessionToken(config),
        Math.min(timeoutMs, 1500),
        'APLUS_FINISH_RECLAIM',
      );
    }

    await withAplusLiveScoreTimeout(
      requestJson(
        'POST',
        APLUS_LIVE_SCORE_ENDPOINTS.finishMatch,
        {matchId: config.matchId},
        {
          score1,
          score2,
          tournamentId: config.tournamentId,
          clientSeq: finishClientSeq,
          clientTimestamp: finishClientTimestamp,
        },
        sessionToken,
      ),
      timeoutMs,
      'APLUS_FINISH_MATCH',
    );

    await removeAplusLiveScoreOutboxEntry(makeAplusOutboxId('finish', config.matchId));
    startedAplusLiveScoreMatchIds.delete(config.matchId);
    startingAplusLiveScoreMatchPromises.delete(config.matchId);
    forgetAplusLiveScoreSession(config.matchId);
  } catch (error) {
    if (isAplusLiveScoreClaimBlockError(error)) {
      forgetAplusLiveScoreSession(config.matchId);
      throw error;
    }

    await upsertAplusLiveScoreOutboxEntry({
      action: 'finish',
      matchId: config.matchId,
      tournamentId: config.tournamentId,
      config,
      score1,
      score2,
      sessionToken: isLiveSessionTokenError(error) ? '' : sessionToken,
      clientSeq: finishClientSeq,
      clientTimestamp: finishClientTimestamp,
    });

    console.log('[AplusLiveScore][FINISH_QUEUED_OUTBOX]', {
      matchId: config.matchId,
      score1,
      score2,
      reason: (error as Error)?.message || error,
    });
    throw error;
  }
};

export const releaseAplusLiveScoreMatch = async (config?: AplusLiveScoreConfig) => {
  if (!config?.matchId) {
    return;
  }

  const sessionToken = getCachedAplusLiveScoreSessionToken(config);
  if (!sessionToken) {
    return;
  }

  try {
    await requestJson(
      'POST',
      APLUS_LIVE_SCORE_ENDPOINTS.releaseMatch,
      {matchId: config.matchId},
      {},
      sessionToken,
    );
  } catch (error) {
    if (!isAplusLiveScoreClaimBlockError(error) && !isLiveSessionTokenError(error)) {
      throw error;
    }
  }

  startedAplusLiveScoreMatchIds.delete(config.matchId);
  startingAplusLiveScoreMatchPromises.delete(config.matchId);
  forgetAplusLiveScoreSession(config.matchId);
};
