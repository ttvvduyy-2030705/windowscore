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
