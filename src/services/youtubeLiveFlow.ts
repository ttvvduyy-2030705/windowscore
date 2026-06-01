import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LIVESTREAM_ACCOUNT_STORAGE_KEY,
  LIVESTREAM_AUTH_BASE_URL,
  isConfiguredLivestreamBaseUrl,
  normalizeLivestreamBaseUrl,
} from 'config/livestreamAuth';

export type YouTubeEligibilityCheck = {
  key: 'subscribers' | 'liveEnabled';
  label: string;
  status: 'pass' | 'fail' | 'unknown';
  detail: string;
};

export type YouTubeEligibilityResponse = {
  ok: boolean;
  platform?: 'youtube';
  connected?: boolean;
  accountName?: string;
  accountId?: string;
  channelId?: string;
  channelTitle?: string;
  subscriberCount?: number | null;
  hiddenSubscriberCount?: boolean;
  meetsMobileLiveSubscriberRequirement?: boolean | null;
  liveEnabled?: boolean | null;
  liveEnabledReason?: string;
  checks?: YouTubeEligibilityCheck[];
  errorCode?: string;
  message?: string;
};

export type YouTubeCreateLivePayload = {
  title: string;
  description?: string;
  privacyStatus?: 'public' | 'private' | 'unlisted';
  scheduledStartTime?: string;
  enableAutoStart?: boolean;
  enableAutoStop?: boolean;
  enableDvr?: boolean;
  recordFromStart?: boolean;
  resolution?: string;
  frameRate?: string;
  latencyPreference?: 'normal' | 'low' | 'ultraLow';
  enableLowLatency?: boolean;
};

const maskSecret = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.length <= 8) {
    return `${raw.slice(0, 2)}****`;
  }
  return `${raw.slice(0, 4)}-****-${raw.slice(-4)}`;
};

const sanitizeYouTubeLiveLogPayload = (value: any): any => {
  if (Array.isArray(value)) {
    return value.map(sanitizeYouTubeLiveLogPayload);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: any = {};
  Object.keys(value).forEach(key => {
    const lowerKey = key.toLowerCase();
    const item = value[key];

    if (
      lowerKey.includes('streamname') ||
      lowerKey.includes('streamkey') ||
      lowerKey === 'key'
    ) {
      result[key] = maskSecret(item);
      return;
    }

    if (lowerKey.includes('streamurlwithkey')) {
      const raw = String(item || '');
      const lastSlash = raw.lastIndexOf('/');
      result[key] = lastSlash >= 0
        ? `${raw.slice(0, lastSlash + 1)}${maskSecret(raw.slice(lastSlash + 1))}`
        : maskSecret(raw);
      return;
    }

    result[key] = sanitizeYouTubeLiveLogPayload(item);
  });

  return result;
};

type StoredSetup = {
  setupToken?: string;
};

type StorageShape = {
  youtube?: StoredSetup;
};

type YouTubeLiveSession = {
  id: string;
  broadcastId: string;
  streamId: string;
  title: string;
  description: string;
  privacyStatus: string;
  scheduledStartTime: string;
  streamUrl: string;
  streamName: string;
  streamUrlWithKey: string;
  watchUrl: string;
  streamStatus: string;
  broadcastStatus: string;
  latencyPreference?: 'normal' | 'low' | 'ultraLow' | string | null;
  enableLowLatency?: boolean | null;
  enableDvr?: boolean | null;
  enableAutoStop?: boolean | null;
  backendBuild?: string | null;
  createdAt: string;
  updatedAt: string;
};

const getYouTubeSetupToken = async () => {
  try {
    const raw = await AsyncStorage.getItem(LIVESTREAM_ACCOUNT_STORAGE_KEY);
    if (!raw) {
      return '';
    }

    const parsed = JSON.parse(raw) as StorageShape;
    return parsed?.youtube?.setupToken || '';
  } catch (_error) {
    return '';
  }
};


export const isYouTubeNotConnectedError = (error: any) => {
  const errorCode = String(error?.payload?.errorCode || error?.errorCode || '').trim().toLowerCase();
  const message = String(error?.payload?.message || error?.message || error || '').toLowerCase();
  return errorCode === 'not_connected' || message.includes('chưa kết nối youtube') || message.includes('not connected');
};

export const clearStoredYouTubeConnection = async () => {
  try {
    const raw = await AsyncStorage.getItem(LIVESTREAM_ACCOUNT_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as any) : {};
    const previousYoutube = parsed?.youtube || {};
    const nextValue = {
      ...parsed,
      youtube: {
        ...previousYoutube,
        accountName: '',
        accountId: '',
        setupToken: '',
      },
    };
    await AsyncStorage.setItem(LIVESTREAM_ACCOUNT_STORAGE_KEY, JSON.stringify(nextValue));
    console.log('[YouTube OAuth] cleared stale local connection after backend not_connected');
  } catch (error: any) {
    console.log('[YouTube OAuth] clear stale connection failed', error?.message || String(error));
  }
};

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const baseUrl = normalizeLivestreamBaseUrl(LIVESTREAM_AUTH_BASE_URL);

  if (!isConfiguredLivestreamBaseUrl(baseUrl)) {
    throw new Error(
      'Bạn chưa cấu hình production backend cho YouTube Live trên bản release.',
    );
  }

  const setupToken = await getYouTubeSetupToken();
  const headers = new Headers(init?.headers || {});

  if (setupToken) {
    headers.set('Authorization', `Bearer ${setupToken}`);
    headers.set('X-Livestream-Setup-Token', setupToken);
  }

  const method = init?.method || 'GET';

  console.log(`[YouTube Live API] request ${method} ${path}`);
  console.log('[YouTube Live API] baseUrl=' + baseUrl);
  console.log('[YouTube Live API] request meta:', {
    path,
    baseUrl,
    method,
    hasSetupToken: Boolean(setupToken),
  });

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();

  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      data = {message: text};
    }
  }

  console.log('[YouTube Live API] response status=' + response.status);
  console.log('[YouTube Live API] response body=', sanitizeYouTubeLiveLogPayload(data));
  console.log('[YouTube Live API] response:', {
    path,
    status: response.status,
    ok: response.ok,
    apiOk: data?.ok,
    errorCode: data?.errorCode,
  });

  const isRedundantTransition =
    path.startsWith('/live/youtube/status/') &&
    String(data?.message || '').toLowerCase().includes('redundant transition');

  if (isRedundantTransition) {
    // Do NOT fake live/active here. YouTube may return "Redundant transition"
    // while the public watch page is still showing scheduled/offline. Return a
    // marker so the caller can keep polling until a real 200 response reports
    // broadcast=live and stream=active.
    console.log('[YouTube Live API] redundant transition received; keep polling for real live/active status');
    return {
      ok: true,
      redundantTransition: true,
      autoTransitioned: true,
      message: data?.message || 'Redundant transition',
      broadcast: {status: {lifeCycleStatus: 'transitioning'}},
      stream: {status: {streamStatus: 'transitioning'}},
    } as T;
  }

  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.message || 'Live API request failed');
    (error as any).payload = data;
    throw error;
  }

  return data as T;
};

export const getYouTubeLiveEligibility =
  async (): Promise<YouTubeEligibilityResponse> => {
    return requestJson<YouTubeEligibilityResponse>('/live/youtube/eligibility');
  };


const assertYouTubeUltraLowBackendApplied = (data: {session?: YouTubeLiveSession; raw?: any}) => {
  const session = data?.session || ({} as YouTubeLiveSession);
  const rawLatency =
    session.latencyPreference ||
    data?.raw?.broadcast?.contentDetails?.latencyPreference ||
    '';
  const latencyPreference = String(rawLatency || '').trim();
  const enableDvr = session.enableDvr ?? data?.raw?.broadcast?.contentDetails?.enableDvr;
  const enableAutoStop = session.enableAutoStop ?? data?.raw?.broadcast?.contentDetails?.enableAutoStop;

  console.log('[YouTube LowDelay Guard] backend latency check', {
    broadcastId: session.broadcastId || session.id || '',
    latencyPreference: latencyPreference || 'missing',
    enableDvr,
    enableAutoStop,
    backendBuild: session.backendBuild || 'missing',
  });

  if (latencyPreference !== 'ultraLow' || enableDvr !== false || enableAutoStop !== false) {
    throw new Error(
      [
        'Backend YouTube Live trên Render chưa chạy bản ultra-low latency.',
        `YouTube đang trả về latencyPreference=${latencyPreference || 'missing'}, enableDvr=${String(enableDvr)}, enableAutoStop=${String(enableAutoStop)}.`,
        'Hãy deploy lại thư mục backend lên Render rồi tạo phiên live mới. Nếu vẫn chạy tiếp với backend này thì YouTube sẽ giữ delay 15-30 giây.',
      ].join(' '),
    );
  }
};

export const createYouTubeLiveSession = async (
  payload: YouTubeCreateLivePayload,
) => {
  const data = await requestJson<{
    ok: boolean;
    platform: 'youtube';
    session: YouTubeLiveSession;
    raw: any;
  }>('/live/youtube/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!data?.session?.streamUrlWithKey) {
    throw new Error(
      'Backend đã tạo phiên YouTube nhưng chưa trả về RTMP URL/stream key.',
    );
  }

  assertYouTubeUltraLowBackendApplied(data);

  return data;
};

export const getYouTubeLiveStatus = async (broadcastId: string) => {
  return requestJson(`/live/youtube/status/${encodeURIComponent(broadcastId)}`);
};

export const stopYouTubeLiveSession = async (broadcastId: string) => {
  if (!broadcastId) {
    return null;
  }

  return requestJson('/live/youtube/stop', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({broadcastId}),
  });
};
