import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  APLUS_LIVE_SCORE_API_BASE_URL,
  APLUS_LIVE_SCORE_API_KEY,
  APLUS_LIVE_SCORE_DEVICE_ID_STORAGE_KEY,
  APLUS_LIVE_SCORE_DEVICE_NAME_STORAGE_KEY,
  APLUS_LIVE_SCORE_REQUEST_TIMEOUT_MS,
  APLUS_LIVE_SCORE_SESSION_STORAGE_KEY,
  isConfiguredAplusLiveScoreBaseUrl,
  normalizeAplusLiveScoreBaseUrl,
} from 'config/aplusLiveScore';
import type {
  AplusClaimMatchPayload,
  AplusClaimMatchResponse,
  AplusFindMatchResponse,
  AplusFinishMatchPayload,
  AplusFinishMatchResponse,
  AplusHeartbeatResponse,
  AplusListTournamentsResponse,
  AplusLiveApiErrorShape,
  AplusLiveSession,
  AplusReleaseMatchResponse,
  AplusSendScorePayload,
  AplusSendScoreResponse,
  AplusTournamentMatchesResponse,
  AplusTournamentOption,
} from 'types/aplusLiveScore';

class AplusLiveScoreError extends Error {
  status?: number;
  liveControllerName?: string;
  lockExpiresAt?: string;

  constructor(
    message: string,
    options?: {
      status?: number;
      liveControllerName?: string;
      lockExpiresAt?: string;
    },
  ) {
    super(message);
    this.name = 'AplusLiveScoreError';
    this.status = options?.status;
    this.liveControllerName = options?.liveControllerName;
    this.lockExpiresAt = options?.lockExpiresAt;
  }
}

export {AplusLiveScoreError};

const createFallbackId = () => {
  const random = Math.random().toString(16).slice(2);
  return `windows-${Date.now().toString(16)}-${random}`;
};

const parseJsonSafely = async (response: Response) => {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return {message: text};
  }
};

const buildUrl = (path: string) => {
  const baseUrl = normalizeAplusLiveScoreBaseUrl(APLUS_LIVE_SCORE_API_BASE_URL);

  if (!isConfiguredAplusLiveScoreBaseUrl(baseUrl)) {
    throw new AplusLiveScoreError(
      'Chưa cấu hình URL API live score Aplus. Hãy kiểm tra src/config/aplusLiveScore.ts.',
    );
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
};

const requestJson = async <T>(
  path: string,
  init?: RequestInit,
  sessionToken?: string,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    APLUS_LIVE_SCORE_REQUEST_TIMEOUT_MS,
  );

  try {
    const headers = new Headers(init?.headers || {});

    headers.set('x-live-api-key', APLUS_LIVE_SCORE_API_KEY);

    if (sessionToken) {
      headers.set('x-live-session-token', sessionToken);
    }

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(buildUrl(path), {
      ...init,
      headers,
      signal: controller.signal,
    });

    const data = (await parseJsonSafely(response)) as AplusLiveApiErrorShape & T;

    if (!response.ok) {
      throw new AplusLiveScoreError(
        data?.message || data?.error || 'Không gọi được API live score Aplus.',
        {
          status: response.status,
          liveControllerName: data?.liveControllerName,
          lockExpiresAt: data?.lockExpiresAt,
        },
      );
    }

    return data as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new AplusLiveScoreError(
        'Kết nối API live score Aplus quá lâu, vui lòng kiểm tra mạng hoặc backend.',
      );
    }

    if (error instanceof AplusLiveScoreError) {
      throw error;
    }

    throw new AplusLiveScoreError(
      error?.message || 'Không thể kết nối tới API live score Aplus.',
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const getOrCreateAplusLiveDeviceId = async () => {
  const existing = await AsyncStorage.getItem(
    APLUS_LIVE_SCORE_DEVICE_ID_STORAGE_KEY,
  );

  if (existing) {
    return existing;
  }

  const next = createFallbackId();
  await AsyncStorage.setItem(APLUS_LIVE_SCORE_DEVICE_ID_STORAGE_KEY, next);
  return next;
};

export const getAplusLiveDeviceName = async () => {
  const existing = await AsyncStorage.getItem(
    APLUS_LIVE_SCORE_DEVICE_NAME_STORAGE_KEY,
  );

  return existing || 'Bang diem Windows';
};

export const setAplusLiveDeviceName = async (deviceName: string) => {
  const cleanName = deviceName.trim();

  if (!cleanName) {
    await AsyncStorage.removeItem(APLUS_LIVE_SCORE_DEVICE_NAME_STORAGE_KEY);
    return;
  }

  await AsyncStorage.setItem(APLUS_LIVE_SCORE_DEVICE_NAME_STORAGE_KEY, cleanName);
};

export const fetchAplusLiveTournaments = async (): Promise<
  AplusTournamentOption[]
> => {
  const data = await requestJson<AplusListTournamentsResponse>('/tournaments');
  return Array.isArray(data?.tournaments) ? data.tournaments : [];
};

export const findAplusLiveMatchByCode = async (
  tournamentId: string,
  matchCode: string,
): Promise<AplusFindMatchResponse> => {
  const cleanCode = matchCode.trim();

  if (!tournamentId) {
    throw new AplusLiveScoreError('Chưa chọn giải đấu.');
  }

  if (!cleanCode) {
    throw new AplusLiveScoreError('Chưa nhập mã trận.');
  }

  return requestJson<AplusFindMatchResponse>(
    `/tournaments/${encodeURIComponent(
      tournamentId,
    )}/matches/by-code/${encodeURIComponent(cleanCode)}`,
  );
};

export const claimAplusLiveMatch = async (
  matchId: string,
  payload: AplusClaimMatchPayload,
): Promise<AplusClaimMatchResponse> => {
  if (!matchId) {
    throw new AplusLiveScoreError('Thiếu matchId để claim trận.');
  }

  return requestJson<AplusClaimMatchResponse>(`/matches/${matchId}/claim`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const claimAplusLiveMatchWithCurrentDevice = async (
  matchId: string,
  deviceName?: string,
): Promise<AplusClaimMatchResponse> => {
  const deviceId = await getOrCreateAplusLiveDeviceId();
  const resolvedDeviceName = deviceName?.trim() || (await getAplusLiveDeviceName());

  return claimAplusLiveMatch(matchId, {
    deviceId,
    deviceName: resolvedDeviceName,
    appVersion: 'windows-scoreboard-v1',
  });
};

export const sendAplusLiveScore = async (
  matchId: string,
  sessionToken: string,
  payload: AplusSendScorePayload,
): Promise<AplusSendScoreResponse> => {
  if (!matchId || !sessionToken) {
    throw new AplusLiveScoreError('Thiếu phiên điều khiển live score.');
  }

  return requestJson<AplusSendScoreResponse>(
    `/matches/${matchId}/score`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
    sessionToken,
  );
};

export const heartbeatAplusLiveMatch = async (
  matchId: string,
  sessionToken: string,
): Promise<AplusHeartbeatResponse> => {
  if (!matchId || !sessionToken) {
    throw new AplusLiveScoreError('Thiếu phiên điều khiển để giữ khóa trận.');
  }

  return requestJson<AplusHeartbeatResponse>(
    `/matches/${matchId}/heartbeat`,
    {method: 'POST'},
    sessionToken,
  );
};

export const finishAplusLiveMatch = async (
  matchId: string,
  sessionToken: string,
  payload: AplusFinishMatchPayload,
): Promise<AplusFinishMatchResponse> => {
  if (!matchId || !sessionToken) {
    throw new AplusLiveScoreError('Thiếu phiên điều khiển để kết thúc trận.');
  }

  return requestJson<AplusFinishMatchResponse>(
    `/matches/${matchId}/finish`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    sessionToken,
  );
};

export const releaseAplusLiveMatch = async (
  matchId: string,
  sessionToken: string,
): Promise<AplusReleaseMatchResponse> => {
  if (!matchId || !sessionToken) {
    throw new AplusLiveScoreError('Thiếu phiên điều khiển để nhả khóa trận.');
  }

  return requestJson<AplusReleaseMatchResponse>(
    `/matches/${matchId}/release`,
    {method: 'POST'},
    sessionToken,
  );
};

export const fetchAplusLiveTournamentMatches = async (
  tournamentId: string,
): Promise<AplusTournamentMatchesResponse> => {
  if (!tournamentId) {
    throw new AplusLiveScoreError('Thiếu tournamentId để lấy danh sách trận.');
  }

  return requestJson<AplusTournamentMatchesResponse>(
    `/tournaments/${encodeURIComponent(tournamentId)}/matches`,
  );
};

export const saveAplusLiveSession = async (session: AplusLiveSession) => {
  await AsyncStorage.setItem(
    APLUS_LIVE_SCORE_SESSION_STORAGE_KEY,
    JSON.stringify(session),
  );
};

export const getSavedAplusLiveSession = async (): Promise<
  AplusLiveSession | undefined
> => {
  const raw = await AsyncStorage.getItem(APLUS_LIVE_SCORE_SESSION_STORAGE_KEY);

  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as AplusLiveSession;
  } catch (_error) {
    await AsyncStorage.removeItem(APLUS_LIVE_SCORE_SESSION_STORAGE_KEY);
    return undefined;
  }
};

export const clearSavedAplusLiveSession = async () => {
  await AsyncStorage.removeItem(APLUS_LIVE_SCORE_SESSION_STORAGE_KEY);
};

export const createAplusLiveSessionFromClaim = async (
  claim: AplusClaimMatchResponse,
  deviceId: string,
  deviceName: string,
): Promise<AplusLiveSession> => {
  const session: AplusLiveSession = {
    matchId: claim.match._id,
    tournamentId: claim.tournament._id,
    tournamentName: claim.tournament.name,
    matchCode: claim.match.matchCode,
    sessionToken: claim.sessionToken,
    deviceId,
    deviceName,
    lockExpiresAt: claim.lockExpiresAt,
  };

  await saveAplusLiveSession(session);
  return session;
};
