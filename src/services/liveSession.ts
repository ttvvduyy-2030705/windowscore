import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LIVESTREAM_ACCOUNT_STORAGE_KEY,
  LIVESTREAM_AUTH_BASE_URL,
  isConfiguredLivestreamBaseUrl,
  normalizeLivestreamBaseUrl,
} from 'config/livestreamAuth';

export type LivePlatform = 'youtube' | 'facebook';

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

export type FacebookPage = {
  id: string;
  name: string;
  category?: string;
  picture?: string;
  tasks?: string[];
};

export type FacebookCreateLivePayload = {
  title: string;
  description?: string;
  targetType?: 'page' | 'user';
  targetId?: string;
};

type StoredSetup = {
  setupToken?: string;
};

type StorageShape = {
  youtube?: StoredSetup;
  facebook?: StoredSetup;
};

const getSetupToken = async (platform: LivePlatform) => {
  try {
    const raw = await AsyncStorage.getItem(LIVESTREAM_ACCOUNT_STORAGE_KEY);
    if (!raw) {
      return '';
    }

    const parsed = JSON.parse(raw) as StorageShape;
    return parsed?.[platform]?.setupToken || '';
  } catch (_error) {
    return '';
  }
};

const requestJson = async (
  path: string,
  init?: RequestInit,
  platform: LivePlatform = 'youtube',
) => {
  const baseUrl = normalizeLivestreamBaseUrl(LIVESTREAM_AUTH_BASE_URL);

  if (!isConfiguredLivestreamBaseUrl(baseUrl)) {
    throw new Error(
      'Bạn chưa cấu hình production backend cho livestream trên bản release.',
    );
  }

  const setupToken = await getSetupToken(platform);
  const headers = new Headers(init?.headers || {});

  if (setupToken) {
    headers.set('Authorization', `Bearer ${setupToken}`);
    headers.set('X-Livestream-Setup-Token', setupToken);
  }

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

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || 'Live API request failed');
  }

  return data;
};

export const getLiveConnections = async () => {
  return requestJson('/live/connections');
};

export const getFacebookPages = async (): Promise<FacebookPage[]> => {
  const data = await requestJson('/live/facebook/pages', undefined, 'facebook');
  return Array.isArray(data?.pages) ? data.pages : [];
};

export const createYouTubeLive = async (payload: YouTubeCreateLivePayload) => {
  return requestJson(
    '/live/youtube/create',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    'youtube',
  );
};

export const getYouTubeLiveStatus = async (broadcastId: string) => {
  return requestJson(
    `/live/youtube/status/${encodeURIComponent(broadcastId)}`,
    undefined,
    'youtube',
  );
};

export const stopYouTubeLive = async (broadcastId: string) => {
  return requestJson(
    '/live/youtube/stop',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({broadcastId}),
    },
    'youtube',
  );
};

export const createFacebookLive = async (
  payload: FacebookCreateLivePayload,
) => {
  return requestJson(
    '/live/facebook/create',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    'facebook',
  );
};

export const getFacebookLiveStatus = async (liveVideoId: string) => {
  return requestJson(
    `/live/facebook/status/${encodeURIComponent(liveVideoId)}`,
    undefined,
    'facebook',
  );
};

export const stopFacebookLive = async (liveVideoId: string) => {
  return requestJson(
    '/live/facebook/stop',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({liveVideoId}),
    },
    'facebook',
  );
};
