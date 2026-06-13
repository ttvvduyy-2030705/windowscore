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
  isLive?: boolean;
  isFinished?: boolean;
  liveLocked?: boolean;
  liveLockDeviceName?: string;
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

const getDeviceId = async () => {
  try {
    const uniqueId = await DeviceInfo.getUniqueId();
    if (uniqueId) {
      return String(uniqueId);
    }
  } catch (_error) {}

  return 'windows-scoreboard-device';
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
  const urls = method === 'GET'
    ? APLUS_LIVE_SCORE_FALLBACK_BASE_URLS.map(baseUrl =>
        appendNoCacheQuery(buildUrlWithBase(baseUrl, path, params)),
      )
    : [buildUrl(path, params)];

  let lastNetworkError: unknown = null;

  for (const url of urls) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-live-api-key': APLUS_LIVE_SCORE_API_KEY,
      'x-aplus-device': APLUS_LIVE_SCORE_DEVICE_NAME,
    };

    if (sessionToken) {
      headers['x-live-session-token'] = sessionToken;
    }

    console.log('[AplusLiveScore][HTTP_START]', {
      method,
      url,
      hasSessionToken: Boolean(sessionToken),
      body: method === 'GET' ? undefined : body,
    });

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
    } catch (error) {
      lastNetworkError = error;
      console.log('[AplusLiveScore][NETWORK_ERROR]', {
        method,
        url,
        message: String((error as Error)?.message || error),
      });

      if (method === 'GET' && url !== urls[urls.length - 1]) {
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

    console.log('[AplusLiveScore][HTTP_OK]', {
      method,
      url,
      status: response.status,
      data,
    });

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

  return {id, name, gameType, raw: item};
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
    player1,
    player2,
    raw: match,
  };
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
  matchNumber: string,
): Promise<AplusLiveMatch> => {
  const safeMatchNumber = toText(matchNumber);
  if (!safeMatchNumber) {
    throw new Error('Bạn chưa nhập số trận.');
  }

  const variants = normalizeAplusMatchCodeVariants(safeMatchNumber);
  const retryDelays = [0, 450, 900, 1600, 2600, 4200];
  let lastError: any = null;
  let lastAvailableCodes: string[] = [];
  let lastListTotal = 0;
  let lookupTournament = tournament;

  console.log('[AplusLiveScore][MATCH_LOOKUP_START_V3_LIVE_LIST_FIRST]', {
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    input: safeMatchNumber,
    variants,
  });

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    const delay = retryDelays[attempt];

    if (delay > 0) {
      console.log('[AplusLiveScore][MATCH_LOOKUP_WAIT_FOR_SYNC]', {
        input: safeMatchNumber,
        attempt: attempt + 1,
        waitMs: delay,
      });
      await waitAplusLiveScore(delay);
    }

    lookupTournament = await refreshTournamentBeforeMatchLookup(lookupTournament);

    // 1) Ưu tiên cách ổn định nhất: lấy danh sách trận public từ live-api rồi tự tìm trong app.
    // Cách này tránh lỗi 401 của endpoint by-code và tránh gọi nhầm admin API cũ.
    try {
      const matches = await fetchFreshMatchListForTournament(lookupTournament);
      lastListTotal = matches.length;
      lastAvailableCodes = matches
        .slice(0, 100)
        .map(item => getMatchCodeCandidatesFromRaw(item).join('/'))
        .filter(Boolean);

      const found = findMatchInListByCode(matches, variants);

      if (found) {
        const match = normalizeMatch(found, lookupTournament, safeMatchNumber);
        if (match.id) {
          console.log('[AplusLiveScore][MATCH_LOOKUP_OK_LIST_FIRST]', {
            input: safeMatchNumber,
            attempt: attempt + 1,
            variants,
            matchId: match.id,
            matchNumber: match.matchNumber,
            totalMatches: matches.length,
          });
          return match;
        }

        lastError = new Error('Live API trả về trận nhưng thiếu matchId.');
      }

      console.log('[AplusLiveScore][MATCH_LOOKUP_LIST_NOT_FOUND]', {
        input: safeMatchNumber,
        attempt: attempt + 1,
        variants,
        tournamentId: lookupTournament.id,
        totalMatches: matches.length,
        availableCodes: lastAvailableCodes,
      });
    } catch (error: any) {
      lastError = error;
      console.log('[AplusLiveScore][MATCH_LOOKUP_LIST_FAILED]', {
        input: safeMatchNumber,
        attempt: attempt + 1,
        tournamentId: lookupTournament.id,
        message: error?.message || String(error),
      });
    }

    // 2) Fallback phụ: thử by-code. Nếu endpoint này trả 401/API key thì bỏ qua,
    // không cho UI hiện "Không có quyền truy cập" vì danh sách trận public mới là nguồn chính.
    for (const code of variants) {
      try {
        const data = await requestJson(
          'GET',
          APLUS_LIVE_SCORE_ENDPOINTS.matchByCode,
          {
            tournamentId: lookupTournament.id,
            matchCode: code,
          },
        );

        const match = normalizeMatch(data, lookupTournament, code);
        if (match.id) {
          console.log('[AplusLiveScore][MATCH_LOOKUP_OK_DIRECT_FALLBACK]', {
            input: safeMatchNumber,
            attempt: attempt + 1,
            usedCode: code,
            matchId: match.id,
            matchNumber: match.matchNumber,
          });
          return match;
        }

        lastError = new Error('Web trả về trận nhưng thiếu matchId.');
      } catch (error: any) {
        const authError = isAplusLiveScoreAuthError(error);
        if (!authError) {
          lastError = error;
        }

        console.log('[AplusLiveScore][MATCH_LOOKUP_DIRECT_FALLBACK_MISS]', {
          input: safeMatchNumber,
          attempt: attempt + 1,
          triedCode: code,
          ignoredAuthError: authError,
          message: error?.message || String(error),
        });
      }
    }
  }

  const availableText = lastAvailableCodes.length
    ? lastAvailableCodes.slice(0, 30).join(', ')
    : 'chưa có trận nào trong live-api';

  if (lastError && !isAplusLiveScoreAuthError(lastError)) {
    throw new Error(
      lastError?.message ||
        `Không tìm thấy trận ${safeMatchNumber}. Mã trận đang có: ${availableText}.`,
    );
  }

  throw new Error(
    `Không tìm thấy trận ${safeMatchNumber} trong giải ${lookupTournament.name}. ` +
      `App đã lấy danh sách trận từ live-api nhưng chưa thấy mã này. ` +
      `Số trận live-api đang có: ${lastListTotal}. Mã đang có: ${availableText}.`,
  );
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

  const players = playerSettings.playingPlayers.slice(0, 2);
  const score1 = Number(players[0]?.totalPoint || 0);
  const score2 = Number(players[1]?.totalPoint || 0);
  const player1Name = getPlayerNameForPayload(players[0], 'Người chơi 1');
  const player2Name = getPlayerNameForPayload(players[1], 'Người chơi 2');
  const player1Country = getPlayerCountryForPayload(players[0]);
  const player2Country = getPlayerCountryForPayload(players[1]);

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
    player1Name,
    player2Name,
    player1Country,
    player2Country,
    player1CountryCode: player1Country,
    player2CountryCode: player2Country,
    player1: {
      name: player1Name,
      countryCode: player1Country,
      countryName: player1Country,
      flag: player1Country,
    },
    player2: {
      name: player2Name,
      countryCode: player2Country,
      countryName: player2Country,
      flag: player2Country,
    },
    status: winner ? 'finished' : isStarted ? 'playing' : 'upcoming',
    isLive: Boolean(isStarted && !winner),

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
    countdownStatus: winner ? 'finished' : liveCountdownIsRunning ? 'running' : 'paused',
    countdownUpdatedAt: new Date().toISOString(),
    liveCountdownTime: resolvedCountdownTime,
    liveCountdownBaseTime: resolvedCountdownBaseTime,
    liveCountdownIsRunning,
    liveCountdownStatus: winner ? 'finished' : liveCountdownIsRunning ? 'running' : 'paused',
    liveCountdownUpdatedAt: new Date().toISOString(),
  };

  console.log('[AplusLiveScore][PUSH_SCORE_START]', {
    matchId: config.matchId,
    matchNumber: config.matchNumber,
    tournamentId: config.tournamentId,
    payload,
  });

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

    console.log('[AplusLiveScore][PUSH_SCORE_OK]', {
      matchId: config.matchId,
      result,
    });
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

    console.log('[AplusLiveScore][PUSH_SCORE_OK_AFTER_RECLAIM]', {
      matchId: config.matchId,
      result,
    });
  }
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
) => {
  if (!config?.matchId) {
    return;
  }

  let sessionToken = '';

  try {
    sessionToken = await getOrClaimAplusLiveScoreSessionToken(config);
  } catch (error) {
    if (isAplusLiveScoreClaimBlockError(error)) {
      forgetAplusLiveScoreSession(config.matchId);
      return;
    }
    throw error;
  }

  await requestJson(
    'POST',
    APLUS_LIVE_SCORE_ENDPOINTS.finishMatch,
    {matchId: config.matchId},
    {score1, score2},
    sessionToken,
  );
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

  forgetAplusLiveScoreSession(config.matchId);
};
