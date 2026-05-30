import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {billingRouter} from './billing.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_STORE_PATH = process.env.TOKEN_STORE_PATH || '';
const DATA_DIR = process.env.DATA_DIR ||
  (TOKEN_STORE_PATH
    ? path.dirname(TOKEN_STORE_PATH)
    : path.join(__dirname, '..', 'data'));
const TOKENS_PATH = TOKEN_STORE_PATH || path.join(DATA_DIR, 'tokens.json');

const app = express();
const YOUTUBE_LOW_DELAY_BACKEND_BUILD = 'youtube-ultralow-20260530-strict-v2';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended: true}));

app.use((req, res, next) => {
  const startedAt = Date.now();
  console.log("[HTTP] " + req.method + " " + req.originalUrl + " start");
  res.on("finish", () => {
    console.log(
      "[HTTP] " +
        req.method +
        " " +
        req.originalUrl +
        " -> " +
        res.statusCode +
        " " +
        (Date.now() - startedAt) +
        "ms",
    );
  });
  next();
});

const PORT = Number(process.env.PORT || 8787);

const APP_BASE_URL =
  process.env.APP_BASE_URL || 'https://YOUR_PUBLIC_BACKEND_OR_NGROK_URL';
const APP_CALLBACK_URL =
  process.env.APP_CALLBACK_URL || 'aplusscore://oauth/callback';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || `${APP_BASE_URL}/auth/google/callback`;

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
const FACEBOOK_REDIRECT_URI =
  process.env.FACEBOOK_REDIRECT_URI || `${APP_BASE_URL}/auth/facebook/callback`;
const FACEBOOK_GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v25.0';

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
const TIKTOK_REDIRECT_URI =
  process.env.TIKTOK_REDIRECT_URI || `${APP_BASE_URL}/auth/tiktok/callback`;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {recursive: true});
}

const readTokenStore = () => {
  try {
    if (!fs.existsSync(TOKENS_PATH)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  } catch (_error) {
    return {};
  }
};

const writeTokenStore = value => {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(value, null, 2), 'utf8');
};

const createSetupToken = () => crypto.randomBytes(24).toString('base64url');

const getRequestSetupToken = req => {
  const authHeader = req.get('authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return (
    (bearerMatch ? bearerMatch[1] : '') ||
    req.get('x-livestream-setup-token') ||
    ''
  );
};

const ensureValidSetupToken = (req, res, record, platform = 'youtube') => {
  if (!record?.setupToken) {
    return true;
  }

  const incomingToken = getRequestSetupToken(req);
  if (incomingToken && incomingToken === record.setupToken) {
    return true;
  }

  res.status(401).json({
    ok: false,
    platform,
    errorCode: 'invalid_setup_token',
    message: 'Phiên kết nối livestream không hợp lệ hoặc đã hết hạn. Vui lòng kết nối lại YouTube.',
  });

  return false;
};

const createState = platform => {
  const payload = {
    platform,
    nonce: Math.random().toString(36).slice(2),
    createdAt: Date.now(),
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64url');
};

const parseState = state => {
  if (!state) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
  } catch (_error) {
    return null;
  }
};

const redirectToApp = (res, payload) => {
  const query = new URLSearchParams();

  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });

  res.redirect(`${APP_CALLBACK_URL}?${query.toString()}`);
};

const ensureEnvForOAuth = (res, values, platform) => {
  const missing = values.filter(item => !item.value).map(item => item.name);

  if (!missing.length) {
    return true;
  }

  redirectToApp(res, {
    platform,
    status: 'error',
    errorCode: 'missing_env',
    errorMessage: `Thiếu cấu hình môi trường: ${missing.join(', ')}`,
  });

  return false;
};

const parseResponse = async response => {
  const rawText = await response.text();

  let data = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch (_error) {
      data = {rawText};
    }
  }

  if (!response.ok) {
    const message =
      data.error_description ||
      data.error?.message ||
      data.error?.errors?.[0]?.message ||
      data.error?.error_user_msg ||
      data.error?.error_user_title ||
      data.message ||
      data.rawText ||
      `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  return data;
};

const getJson = async (url, headers = {}) => {
  const response = await fetch(url, {headers});
  return parseResponse(response);
};

const postJson = async (url, body, headers = {}) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  return parseResponse(response);
};

const postForm = async (url, body, headers = {}) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(body),
  });

  return parseResponse(response);
};

const buildYouTubeApiUrl = (pathname, query = {}) => {
  const url = new URL(`https://www.googleapis.com${pathname}`);

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

const buildFacebookApiUrl = (pathname, query = {}) => {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(
    `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}${normalizedPath}`,
  );

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

const ensureConnectedPlatform = (res, platform, store) => {
  const record = store?.[platform];

  if (record?.accessToken) {
    return record;
  }

  res.status(400).json({
    ok: false,
    errorCode: 'not_connected',
    message:
      platform === 'youtube'
        ? 'Bạn chưa kết nối YouTube.'
        : platform === 'facebook'
        ? 'Bạn chưa kết nối Facebook.'
        : 'Bạn chưa kết nối nền tảng này.',
  });

  return null;
};

const ensureYouTubeAccessToken = async store => {
  const record = store.youtube;

  if (!record?.accessToken) {
    throw new Error('Chưa có access token YouTube.');
  }

  if (!record.refreshToken) {
    return record.accessToken;
  }

  const refreshed = await postForm('https://oauth2.googleapis.com/token', {
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: record.refreshToken,
    grant_type: 'refresh_token',
  });

  store.youtube = {
    ...record,
    accessToken: refreshed.access_token,
    expiresIn: refreshed.expires_in,
    scope: refreshed.scope || record.scope,
    tokenType: refreshed.token_type || record.tokenType || 'Bearer',
    obtainedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeTokenStore(store);
  return store.youtube.accessToken;
};

const normalizeIsoDate = value => {
  if (!value) {
    return new Date(Date.now() + 1500).toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Thời gian không hợp lệ.');
  }

  return parsed.toISOString();
};

const normalizeYouTubeLatencyPreference = value => {
  const normalized = String(value || '').trim();
  if (['normal', 'low', 'ultraLow'].includes(normalized)) {
    return normalized;
  }
  return 'ultraLow';
};

const normalizeYouTubePrivacy = value => {
  const allowed = ['public', 'private', 'unlisted'];
  return allowed.includes(value) ? value : 'public';
};

const buildYouTubeBroadcastContentDetails = ({
  enableAutoStart = true,
  enableAutoStop = false,
  enableDvr = false,
  recordFromStart = false,
  latencyPreference = 'ultraLow',
} = {}) => {
  const latency = normalizeYouTubeLatencyPreference(latencyPreference);
  const details = {
    enableAutoStart: Boolean(enableAutoStart),
    enableAutoStop: Boolean(enableAutoStop),
    enableDvr: Boolean(enableDvr),
    recordFromStart: Boolean(recordFromStart),
    latencyPreference: latency,
    monitorStream: {
      enableMonitorStream: false,
    },
  };

  // YouTube's legacy enableLowLatency flag conflicts with ultraLow.
  // For ultraLow, latencyPreference must be the source of truth and
  // enableLowLatency must be omitted. If both are sent, YouTube can silently
  // normalize the broadcast back to normal latency on some channels/backends.
  if (latency === 'low') {
    details.enableLowLatency = true;
  } else if (latency === 'normal') {
    details.enableLowLatency = false;
  }

  return details;
};

const isYouTubeUltraLowLatencyApplied = broadcast => {
  return broadcast?.contentDetails?.latencyPreference === 'ultraLow';
};

const updateYouTubeBroadcastLatency = async ({
  accessToken,
  broadcastId,
  enableAutoStart = true,
  enableAutoStop = false,
  enableDvr = false,
  recordFromStart = false,
  latencyPreference = 'ultraLow',
}) => {
  if (!broadcastId) {
    return null;
  }

  const contentDetails = buildYouTubeBroadcastContentDetails({
    enableAutoStart,
    enableAutoStop,
    enableDvr,
    recordFromStart,
    latencyPreference,
  });

  return fetch(
    buildYouTubeApiUrl('/youtube/v3/liveBroadcasts', {
      part: 'contentDetails',
    }),
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        id: broadcastId,
        contentDetails,
      }),
    },
  ).then(parseResponse);
};


const normalizeFacebookTargetType = value => {
  return value === 'user' ? 'user' : 'page';
};

const getFacebookPagesFromStore = store => {
  return Array.isArray(store?.facebook?.pages) ? store.facebook.pages : [];
};

const sanitizeFacebookPages = pages => {
  return pages.map(page => ({
    id: page.id || '',
    name: page.name || 'Facebook Page',
    category: page.category || '',
    picture: page.picture || '',
    tasks: Array.isArray(page.tasks) ? page.tasks : [],
    canCreateContent: Array.isArray(page.tasks)
      ? page.tasks.includes('CREATE_CONTENT')
      : true,
  }));
};

const getFacebookDefaultTarget = store => {
  const pages = getFacebookPagesFromStore(store);
  const firstPage = pages[0];

  if (firstPage?.id) {
    return {
      type: 'page',
      id: firstPage.id,
      name: firstPage.name || 'Facebook Page',
    };
  }

  return {
    type: 'user',
    id: store?.facebook?.profile?.id || '',
    name: store?.facebook?.profile?.name || 'Facebook Profile',
  };
};

const getFacebookPageAccessToken = (store, pageId) => {
  const pages = getFacebookPagesFromStore(store);
  const page = pages.find(item => item.id === pageId);
  return page?.accessToken || '';
};

const resolveFacebookLiveTarget = (store, requestedTargetType, requestedTargetId) => {
  const profileId = store?.facebook?.profile?.id || '';
  const profileName = store?.facebook?.profile?.name || 'Facebook Profile';
  const pages = getFacebookPagesFromStore(store);
  const requestedType = requestedTargetType === 'user' ? 'user' : requestedTargetType === 'page' ? 'page' : '';

  if (requestedType === 'user') {
    if (!profileId) {
      throw new Error('Không tìm thấy hồ sơ Facebook để phát trực tiếp.');
    }

    return {
      targetType: 'user',
      targetId: profileId,
      targetName: profileName,
      accessToken: store.facebook?.accessToken || '',
      selectedBy: 'explicit_user',
    };
  }

  if (requestedType === 'page') {
    const page = requestedTargetId
      ? pages.find(item => item.id === requestedTargetId)
      : pages[0];

    if (!page?.id || !page?.accessToken) {
      throw new Error(
        requestedTargetId
          ? 'Không tìm thấy Trang Facebook đã chọn hoặc thiếu quyền truy cập Trang.'
          : 'Tài khoản Facebook này chưa có Trang khả dụng để phát trực tiếp.',
      );
    }

    return {
      targetType: 'page',
      targetId: page.id,
      targetName: page.name || 'Facebook Page',
      accessToken: page.accessToken,
      selectedBy: requestedTargetId ? 'explicit_page' : 'implicit_first_page',
    };
  }

  const fallbackPage = pages[0];
  if (fallbackPage?.id && fallbackPage?.accessToken) {
    return {
      targetType: 'page',
      targetId: fallbackPage.id,
      targetName: fallbackPage.name || 'Facebook Page',
      accessToken: fallbackPage.accessToken,
      selectedBy: 'default_page',
    };
  }

  if (!profileId) {
    throw new Error('Không tìm thấy hồ sơ Facebook để phát trực tiếp.');
  }

  return {
    targetType: 'user',
    targetId: profileId,
    targetName: profileName,
    accessToken: store.facebook?.accessToken || '',
    selectedBy: 'default_user',
  };
};

const getFacebookAccessTokenForSession = (store, liveVideoId) => {
  const session = store?.facebook?.liveSessions?.[liveVideoId];

  if (!session) {
    throw new Error('Không tìm thấy phiên live Facebook.');
  }

  if (session.targetType === 'page') {
    const pageAccessToken = getFacebookPageAccessToken(store, session.targetId);

    if (!pageAccessToken) {
      throw new Error('Không tìm thấy access token của Trang Facebook cho phiên live này.');
    }

    return {accessToken: pageAccessToken, session};
  }

  if (!store?.facebook?.accessToken) {
    throw new Error('Không tìm thấy access token Facebook của tài khoản cá nhân.');
  }

  return {accessToken: store.facebook.accessToken, session};
};

const upsertLiveSession = (store, platform, id, session) => {
  store[platform] = {
    ...store[platform],
    liveSessions: {
      ...(store[platform]?.liveSessions || {}),
      [id]: {
        ...(store[platform]?.liveSessions?.[id] || {}),
        ...session,
      },
    },
  };
};

const removeLiveSession = (store, platform, id) => {
  if (!store?.[platform]?.liveSessions?.[id]) {
    return;
  }

  const nextSessions = {...store[platform].liveSessions};
  delete nextSessions[id];

  store[platform] = {
    ...store[platform],
    liveSessions: nextSessions,
  };
};

const toErrorResponse = (res, error, fallbackMessage) => {
  res.status(400).json({
    ok: false,
    message: error?.message || fallbackMessage,
  });
};

const getYouTubeChannelSnapshot = async accessToken => {
  const response = await getJson(
    buildYouTubeApiUrl('/youtube/v3/channels', {
      part: 'snippet,statistics,status',
      mine: 'true',
    }),
    {
      Authorization: `Bearer ${accessToken}`,
    },
  );

  const channel = Array.isArray(response.items) ? response.items[0] : null;
  const statistics = channel?.statistics || {};
  const rawCount = statistics.subscriberCount;
  const subscriberCount =
    rawCount === undefined || rawCount === null || rawCount === ''
      ? null
      : Number(rawCount);

  return {
    channelId: channel?.id || '',
    channelTitle: channel?.snippet?.title || '',
    subscriberCount:
      Number.isFinite(subscriberCount) && subscriberCount !== null
        ? subscriberCount
        : null,
    hiddenSubscriberCount: Boolean(statistics.hiddenSubscriberCount),
    thumbnails: channel?.snippet?.thumbnails || {},
  };
};

const deleteYouTubeBroadcast = async (accessToken, broadcastId) => {
  if (!broadcastId) {
    return;
  }

  const response = await fetch(
    buildYouTubeApiUrl('/youtube/v3/liveBroadcasts', {id: broadcastId}),
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok && response.status !== 204) {
    await parseResponse(response);
  }
};

const deleteYouTubeStream = async (accessToken, streamId) => {
  if (!streamId) {
    return;
  }

  const response = await fetch(
    buildYouTubeApiUrl('/youtube/v3/liveStreams', {id: streamId}),
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok && response.status !== 204) {
    await parseResponse(response);
  }
};

const YOUTUBE_AUTO_GO_LIVE_POLL_INTERVAL_MS = 700;
const YOUTUBE_AUTO_GO_LIVE_MAX_ATTEMPTS = 40;
const youtubeAutoGoLiveJobs = new Map();

const getYouTubeBroadcastById = async (accessToken, broadcastId) => {
  const response = await getJson(
    buildYouTubeApiUrl('/youtube/v3/liveBroadcasts', {
      id: broadcastId,
      part: 'id,snippet,contentDetails,status',
    }),
    {
      Authorization: `Bearer ${accessToken}`,
    },
  );

  return Array.isArray(response.items) ? response.items[0] || null : null;
};

const getYouTubeStreamById = async (accessToken, streamId) => {
  if (!streamId) {
    return null;
  }

  const response = await getJson(
    buildYouTubeApiUrl('/youtube/v3/liveStreams', {
      id: streamId,
      part: 'id,snippet,cdn,status',
    }),
    {
      Authorization: `Bearer ${accessToken}`,
    },
  );

  return Array.isArray(response.items) ? response.items[0] || null : null;
};

const transitionYouTubeBroadcast = async (accessToken, broadcastId, broadcastStatus) => {
  return fetch(
    buildYouTubeApiUrl('/youtube/v3/liveBroadcasts/transition', {
      broadcastStatus,
      id: broadcastId,
      part: 'id,snippet,contentDetails,status',
    }),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  ).then(parseResponse);
};

const updateStoredYouTubeSessionStatus = ({store, broadcastId, broadcast, stream, extra = {}}) => {
  const previous = store.youtube?.liveSessions?.[broadcastId] || {};

  upsertLiveSession(store, 'youtube', broadcastId, {
    ...previous,
    ...(broadcast
      ? {
          title: broadcast.snippet?.title || previous.title || '',
          description: broadcast.snippet?.description || previous.description || '',
          privacyStatus: broadcast.status?.privacyStatus || previous.privacyStatus || 'public',
          scheduledStartTime:
            broadcast.snippet?.scheduledStartTime ||
            previous.scheduledStartTime ||
            normalizeIsoDate(),
          broadcastStatus: broadcast.status?.lifeCycleStatus || previous.broadcastStatus || '',
        }
      : {}),
    ...(stream
      ? {
          streamStatus: stream.status?.streamStatus || previous.streamStatus || '',
        }
      : {}),
    updatedAt: new Date().toISOString(),
    ...extra,
  });
};

const tryAutoTransitionYouTubeBroadcast = async ({
  store,
  accessToken,
  broadcastId,
  streamId,
}) => {
  const broadcast = await getYouTubeBroadcastById(accessToken, broadcastId);
  const stream = await getYouTubeStreamById(accessToken, streamId);

  if (!broadcast) {
    throw new Error('Không tìm thấy broadcast YouTube.');
  }

  updateStoredYouTubeSessionStatus({
    store,
    broadcastId,
    broadcast,
    stream,
  });
  writeTokenStore(store);

  const broadcastStatus = broadcast.status?.lifeCycleStatus || '';
  const streamStatus = stream?.status?.streamStatus || '';

  if (broadcastStatus === 'live' || broadcastStatus === 'complete') {
    return {broadcast, stream, transitioned: false};
  }

  if (streamStatus !== 'active') {
    return {broadcast, stream, transitioned: false};
  }

  const transitionedBroadcast = await transitionYouTubeBroadcast(
    accessToken,
    broadcastId,
    'live',
  );

  updateStoredYouTubeSessionStatus({
    store,
    broadcastId,
    broadcast: transitionedBroadcast,
    stream,
    extra: {autoStartedAt: new Date().toISOString()},
  });
  writeTokenStore(store);

  return {
    broadcast: transitionedBroadcast,
    stream,
    transitioned: true,
  };
};

const scheduleYouTubeAutoGoLive = ({broadcastId, streamId}) => {
  if (!broadcastId || !streamId) {
    return;
  }

  if (youtubeAutoGoLiveJobs.has(broadcastId)) {
    clearTimeout(youtubeAutoGoLiveJobs.get(broadcastId));
    youtubeAutoGoLiveJobs.delete(broadcastId);
  }

  let attempts = 0;

  const tick = async () => {
    attempts += 1;

    try {
      const store = readTokenStore();
      const session = store.youtube?.liveSessions?.[broadcastId];

      if (!session) {
        youtubeAutoGoLiveJobs.delete(broadcastId);
        return;
      }

      const accessToken = await ensureYouTubeAccessToken(store);
      const result = await tryAutoTransitionYouTubeBroadcast({
        store,
        accessToken,
        broadcastId,
        streamId: session.streamId || streamId,
      });

      if (result.transitioned || result.broadcast?.status?.lifeCycleStatus === 'live') {
        console.log(`[YouTube] Broadcast ${broadcastId} transitioned to live.`);
        youtubeAutoGoLiveJobs.delete(broadcastId);
        return;
      }
    } catch (error) {
      console.log(
        `[YouTube] Auto go-live attempt ${attempts} failed for ${broadcastId}: ${error?.message || error}`,
      );
    }

    if (attempts >= YOUTUBE_AUTO_GO_LIVE_MAX_ATTEMPTS) {
      youtubeAutoGoLiveJobs.delete(broadcastId);
      console.log(`[YouTube] Auto go-live timed out for ${broadcastId}.`);
      return;
    }

    const timer = setTimeout(tick, YOUTUBE_AUTO_GO_LIVE_POLL_INTERVAL_MS);
    youtubeAutoGoLiveJobs.set(broadcastId, timer);
  };

  const timer = setTimeout(tick, YOUTUBE_AUTO_GO_LIVE_POLL_INTERVAL_MS);
  youtubeAutoGoLiveJobs.set(broadcastId, timer);
};

const cancelYouTubeAutoGoLive = broadcastId => {
  const timer = youtubeAutoGoLiveJobs.get(broadcastId);
  if (timer) {
    clearTimeout(timer);
    youtubeAutoGoLiveJobs.delete(broadcastId);
  }
};

const probeYouTubeLiveEnabled = async accessToken => {
  const scheduledStartTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  let broadcastId = '';
  let streamId = '';

  try {
    const probeBroadcast = await postJson(
      buildYouTubeApiUrl('/youtube/v3/liveBroadcasts', {
        part: 'snippet,contentDetails,status',
      }),
      {
        snippet: {
          title: `Probe Live ${Date.now()}`,
          description: 'Probe live eligibility',
          scheduledStartTime,
        },
        contentDetails: {
          enableAutoStart: false,
          enableAutoStop: false,
          enableDvr: false,
          recordFromStart: false,
          monitorStream: {
            enableMonitorStream: false,
          },
        },
        status: {
          privacyStatus: 'private',
          selfDeclaredMadeForKids: false,
        },
      },
      {
        Authorization: `Bearer ${accessToken}`,
      },
    );

    broadcastId = probeBroadcast.id || '';

    const probeStream = await postJson(
      buildYouTubeApiUrl('/youtube/v3/liveStreams', {
        part: 'snippet,cdn,contentDetails,status',
      }),
      {
        snippet: {
          title: `Probe Stream ${Date.now()}`,
          description: 'Probe live eligibility',
        },
        cdn: {
          ingestionType: 'rtmp',
          resolution: 'variable',
          frameRate: 'variable',
        },
        contentDetails: {
          isReusable: false,
        },
      },
      {
        Authorization: `Bearer ${accessToken}`,
      },
    );

    streamId = probeStream.id || '';

    await fetch(
      buildYouTubeApiUrl('/youtube/v3/liveBroadcasts/bind', {
        id: broadcastId,
        part: 'id,snippet,contentDetails,status',
        streamId,
      }),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    ).then(parseResponse);

    return {
      liveEnabled: true,
      liveEnabledReason: 'YouTube cho phép tạo phiên live thử nghiệm.',
    };
  } catch (error) {
    const message = error?.message || '';

    if (
      message.includes('not enabled for live streaming') ||
      message.includes('liveStreamingNotEnabled') ||
      message.includes('livePermissionBlocked')
    ) {
      return {
        liveEnabled: false,
        liveEnabledReason: 'YouTube báo kênh hiện chưa được bật quyền livestream.',
      };
    }

    return {
      liveEnabled: null,
      liveEnabledReason: message || 'Không xác định được trạng thái phát trực tiếp từ YouTube.',
    };
  } finally {
    try {
      await deleteYouTubeBroadcast(accessToken, broadcastId);
    } catch (_error) {}
    try {
      await deleteYouTubeStream(accessToken, streamId);
    } catch (_error) {}
  }
};

const buildYouTubeEligibilityPayload = ({
  store,
  snapshot,
  liveEnabled,
  liveEnabledReason,
}) => {
  const subscriberCount = snapshot?.subscriberCount ?? null;
  const meetsSubscriberRequirement =
    typeof subscriberCount === 'number' ? subscriberCount >= 50 : null;

  const subscriberDetail =
    typeof subscriberCount === 'number'
      ? `Kênh hiện có ${subscriberCount} người đăng ký.`
      : Boolean(snapshot?.hiddenSubscriberCount)
      ? 'Không đọc được số người đăng ký vì kênh đang ẩn số người đăng ký.'
      : 'Không đọc được số người đăng ký của kênh.';

  return {
    ok: true,
    platform: 'youtube',
    connected: Boolean(store?.youtube?.accessToken),
    accountName: store?.youtube?.profile?.name || snapshot?.channelTitle || '',
    accountId: store?.youtube?.profile?.id || snapshot?.channelId || '',
    channelId: snapshot?.channelId || '',
    channelTitle: snapshot?.channelTitle || '',
    subscriberCount,
    hiddenSubscriberCount: Boolean(snapshot?.hiddenSubscriberCount),
    meetsMobileLiveSubscriberRequirement: meetsSubscriberRequirement,
    liveEnabled,
    liveEnabledReason: liveEnabledReason || '',
    checks: [
      {
        key: 'subscribers',
        label: 'Tối thiểu 50 người đăng ký',
        status:
          meetsSubscriberRequirement === null
            ? 'unknown'
            : meetsSubscriberRequirement
            ? 'pass'
            : 'fail',
        detail: subscriberDetail,
      },
      {
        key: 'liveEnabled',
        label: 'Phát trực tiếp đã bật',
        status:
          liveEnabled === true ? 'pass' : liveEnabled === false ? 'fail' : 'unknown',
        detail:
          liveEnabled === true
            ? 'Kênh hiện có thể dùng tính năng phát trực tiếp.'
            : liveEnabled === false
            ? liveEnabledReason || 'YouTube báo kênh hiện chưa được bật quyền livestream.'
            : 'Chưa xác định được trạng thái phát trực tiếp từ YouTube.',
      },
    ],
  };
};

const sendHealth = (_req, res) => {
  res.json({
    ok: true,
    appBaseUrl: APP_BASE_URL,
    callback: APP_CALLBACK_URL,
    now: new Date().toISOString(),
  });
};

app.get('/', sendHealth);
app.get('/health', sendHealth);

app.use('/billing', billingRouter);

app.get('/live/connections', (_req, res) => {
  const store = readTokenStore();

  res.json({
    ok: true,
    youtube: {
      connected: Boolean(store.youtube?.accessToken),
      accountName: store.youtube?.profile?.name || '',
      accountId: store.youtube?.profile?.id || '',
      updatedAt: store.youtube?.updatedAt || '',
    },
    facebook: {
      connected: Boolean(store.facebook?.accessToken),
      accountName: store.facebook?.profile?.name || '',
      accountId: store.facebook?.profile?.id || '',
      updatedAt: store.facebook?.updatedAt || '',
      pagesCount: Array.isArray(store.facebook?.pages)
        ? store.facebook.pages.length
        : 0,
      defaultTarget: getFacebookDefaultTarget(store),
    },
  });
});

app.get('/auth/google/start', (_req, res) => {
  if (
    !ensureEnvForOAuth(
      res,
      [
        {name: 'GOOGLE_CLIENT_ID', value: GOOGLE_CLIENT_ID},
        {name: 'GOOGLE_CLIENT_SECRET', value: GOOGLE_CLIENT_SECRET},
        {name: 'GOOGLE_REDIRECT_URI', value: GOOGLE_REDIRECT_URI},
      ],
      'youtube',
    )
  ) {
    return;
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set(
    'scope',
    [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/youtube',
    ].join(' '),
  );
  url.searchParams.set('state', createState('youtube'));

  res.redirect(url.toString());
});

app.get('/auth/google/callback', async (req, res) => {
  const {code, error, state} = req.query;
  const parsedState = parseState(state);

  if (error) {
    redirectToApp(res, {
      platform: 'youtube',
      status: 'error',
      errorCode: error,
      errorMessage: 'Người dùng đã hủy hoặc Google từ chối đăng nhập.',
    });
    return;
  }

  if (!code || parsedState?.platform !== 'youtube') {
    redirectToApp(res, {
      platform: 'youtube',
      status: 'error',
      errorCode: 'invalid_callback',
      errorMessage: 'Callback YouTube không hợp lệ.',
    });
    return;
  }

  try {
    const tokenData = await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const profile = await getJson(
      `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${encodeURIComponent(
        tokenData.access_token,
      )}`,
    );

    const channelSnapshot = await getYouTubeChannelSnapshot(tokenData.access_token);

    const store = readTokenStore();
    const setupToken = store.youtube?.setupToken || createSetupToken();
    store.youtube = {
      ...store.youtube,
      setupToken,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || store.youtube?.refreshToken || '',
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope,
      tokenType: tokenData.token_type,
      obtainedAt: new Date().toISOString(),
      profile: {
        id: channelSnapshot.channelId || profile.id,
        name:
          channelSnapshot.channelTitle ||
          profile.name ||
          profile.email ||
          'YouTube Account',
        email: profile.email || '',
        picture: profile.picture || '',
        subscriberCount: channelSnapshot.subscriberCount,
        hiddenSubscriberCount: channelSnapshot.hiddenSubscriberCount,
      },
      channel: channelSnapshot,
      updatedAt: new Date().toISOString(),
    };

    writeTokenStore(store);

    console.log('[YouTube OAuth] connected', {
      accountName: store.youtube.profile.name,
      accountId: store.youtube.profile.id,
      hasAccessToken: Boolean(store.youtube.accessToken),
      hasRefreshToken: Boolean(store.youtube.refreshToken),
      hasSetupToken: Boolean(store.youtube.setupToken),
    });

    redirectToApp(res, {
      platform: 'youtube',
      status: 'success',
      accountName: store.youtube.profile.name,
      accountId: store.youtube.profile.id,
      setupToken: store.youtube.setupToken,
    });
  } catch (oauthError) {
    redirectToApp(res, {
      platform: 'youtube',
      status: 'error',
      errorCode: 'google_exchange_failed',
      errorMessage: oauthError.message,
    });
  }
});

app.get('/auth/facebook/start', (_req, res) => {
  if (
    !ensureEnvForOAuth(
      res,
      [
        {name: 'FACEBOOK_APP_ID', value: FACEBOOK_APP_ID},
        {name: 'FACEBOOK_APP_SECRET', value: FACEBOOK_APP_SECRET},
        {name: 'FACEBOOK_REDIRECT_URI', value: FACEBOOK_REDIRECT_URI},
      ],
      'facebook',
    )
  ) {
    return;
  }

  const url = new URL(
    `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
  );
  url.searchParams.set('client_id', FACEBOOK_APP_ID);
  url.searchParams.set('redirect_uri', FACEBOOK_REDIRECT_URI);
  url.searchParams.set('state', createState('facebook'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set(
    'scope',
    [
      'public_profile',
      'email',
      'publish_video',
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
    ].join(','),
  );

  res.redirect(url.toString());
});

app.get('/auth/facebook/callback', async (req, res) => {
  const {code, error, state} = req.query;
  const parsedState = parseState(state);

  if (error) {
    redirectToApp(res, {
      platform: 'facebook',
      status: 'error',
      errorCode: error,
      errorMessage: 'Người dùng đã hủy hoặc Facebook từ chối đăng nhập.',
    });
    return;
  }

  if (!code || parsedState?.platform !== 'facebook') {
    redirectToApp(res, {
      platform: 'facebook',
      status: 'error',
      errorCode: 'invalid_callback',
      errorMessage: 'Callback Facebook không hợp lệ.',
    });
    return;
  }

  try {
    const tokenUrl = buildFacebookApiUrl('/oauth/access_token', {
      client_id: FACEBOOK_APP_ID,
      client_secret: FACEBOOK_APP_SECRET,
      redirect_uri: FACEBOOK_REDIRECT_URI,
      code: String(code),
    });

    const tokenData = await getJson(tokenUrl);

    const profile = await getJson(
      buildFacebookApiUrl('/me', {
        fields: 'id,name,email,picture',
        access_token: tokenData.access_token,
      }),
    );

    const pagesResponse = await getJson(
      buildFacebookApiUrl('/me/accounts', {
        fields: 'id,name,category,tasks,picture{url},access_token',
        access_token: tokenData.access_token,
      }),
    ).catch(() => ({data: []}));

    const rawPages = Array.isArray(pagesResponse?.data) ? pagesResponse.data : [];

    const pages = rawPages.map(page => ({
      id: page.id || '',
      name: page.name || 'Facebook Page',
      category: page.category || '',
      picture: page.picture?.data?.url || '',
      tasks: Array.isArray(page.tasks) ? page.tasks : [],
      accessToken: page.access_token || '',
    }));

    const store = readTokenStore();
    store.facebook = {
      ...store.facebook,
      accessToken: tokenData.access_token,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in,
      obtainedAt: new Date().toISOString(),
      profile: {
        id: profile.id,
        name: profile.name || 'Facebook Account',
        email: profile.email || '',
        picture: profile.picture?.data?.url || '',
      },
      pages,
      defaultTarget: getFacebookDefaultTarget({
        facebook: {
          profile: {
            id: profile.id,
            name: profile.name || 'Facebook Account',
          },
          pages,
        },
      }),
      updatedAt: new Date().toISOString(),
    };

    writeTokenStore(store);

    const defaultTarget = getFacebookDefaultTarget(store);

    redirectToApp(res, {
      platform: 'facebook',
      status: 'success',
      accountName: store.facebook.profile.name,
      accountId: store.facebook.profile.id,
      pagesCount: pages.length,
      defaultTargetType: defaultTarget.type,
      defaultTargetId: defaultTarget.id,
      defaultTargetName: defaultTarget.name,
    });
  } catch (oauthError) {
    redirectToApp(res, {
      platform: 'facebook',
      status: 'error',
      errorCode: 'facebook_exchange_failed',
      errorMessage: oauthError.message,
    });
  }
});

app.get('/live/facebook/pages', (_req, res) => {
  const store = readTokenStore();
  const record = ensureConnectedPlatform(res, 'facebook', store);

  if (!record) {
    return;
  }

  const pages = sanitizeFacebookPages(getFacebookPagesFromStore(store));
  const defaultTarget = getFacebookDefaultTarget(store);

  res.json({
    ok: true,
    pages,
    hasPages: pages.length > 0,
    defaultTarget,
    profile: {
      id: store.facebook?.profile?.id || '',
      name: store.facebook?.profile?.name || '',
      picture: store.facebook?.profile?.picture || '',
    },
  });
});

app.post('/live/facebook/create', async (req, res) => {
  try {
    const store = readTokenStore();
    const record = ensureConnectedPlatform(res, 'facebook', store);

    if (!record) {
      return;
    }

    const {title, description = '', targetType, targetId} = req.body || {};

    if (!title || !String(title).trim()) {
      res.status(400).json({
        ok: false,
        message: 'Thiếu tiêu đề phiên live Facebook.',
      });
      return;
    }

    const resolvedTarget = resolveFacebookLiveTarget(store, targetType, targetId);

    const liveVideo = await postForm(
      buildFacebookApiUrl(`/${resolvedTarget.targetId}/live_videos`),
      {
        status: 'LIVE_NOW',
        title: String(title).trim(),
        description: String(description || ''),
        access_token: resolvedTarget.accessToken,
      },
    );

    const session = {
      id: liveVideo.id || '',
      liveVideoId: liveVideo.id || '',
      title: String(title).trim(),
      description: String(description || ''),
      targetType: resolvedTarget.targetType,
      targetId: resolvedTarget.targetId,
      targetName: resolvedTarget.targetName,
      selectedBy: resolvedTarget.selectedBy,
      streamUrl: liveVideo.stream_url || '',
      secureStreamUrl: liveVideo.secure_stream_url || '',
      streamSecondaryUrls: Array.isArray(liveVideo.stream_secondary_urls)
        ? liveVideo.stream_secondary_urls
        : [],
      secureStreamSecondaryUrls: Array.isArray(liveVideo.secure_stream_secondary_urls)
        ? liveVideo.secure_stream_secondary_urls
        : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    upsertLiveSession(store, 'facebook', session.liveVideoId, session);
    writeTokenStore(store);

    res.json({
      ok: true,
      platform: 'facebook',
      session,
      raw: liveVideo,
    });
  } catch (error) {
    toErrorResponse(res, error, 'Không thể tạo phiên live Facebook.');
  }
});

app.get('/live/facebook/status/:liveVideoId', async (req, res) => {
  try {
    const store = readTokenStore();
    const record = ensureConnectedPlatform(res, 'facebook', store);

    if (!record) {
      return;
    }

    const {liveVideoId} = req.params;
    const {accessToken, session} = getFacebookAccessTokenForSession(store, liveVideoId);

    const liveVideo = await getJson(
      buildFacebookApiUrl(`/${liveVideoId}`, {
        fields:
          'id,status,permalink_url,embed_html,title,description,creation_time,live_views,secure_stream_url,stream_url,ingest_streams,errors',
        access_token: accessToken,
      }),
    );

    upsertLiveSession(store, 'facebook', liveVideoId, {
      ...session,
      title: liveVideo.title || session.title || '',
      description: liveVideo.description || session.description || '',
      updatedAt: new Date().toISOString(),
    });
    writeTokenStore(store);

    res.json({
      ok: true,
      liveVideo,
      session: store.facebook?.liveSessions?.[liveVideoId] || session,
    });
  } catch (error) {
    toErrorResponse(res, error, 'Không thể lấy trạng thái live Facebook.');
  }
});

app.post('/live/facebook/stop', async (req, res) => {
  try {
    const store = readTokenStore();
    const record = ensureConnectedPlatform(res, 'facebook', store);

    if (!record) {
      return;
    }

    const {liveVideoId} = req.body || {};

    if (!liveVideoId) {
      res.status(400).json({
        ok: false,
        message: 'Thiếu liveVideoId Facebook.',
      });
      return;
    }

    const {accessToken} = getFacebookAccessTokenForSession(store, liveVideoId);

    const ended = await postForm(
      buildFacebookApiUrl(`/${liveVideoId}`),
      {
        end_live_video: 'true',
        access_token: accessToken,
      },
    );

    removeLiveSession(store, 'facebook', liveVideoId);
    writeTokenStore(store);

    res.json({
      ok: true,
      liveVideoId,
      raw: ended,
    });
  } catch (error) {
    toErrorResponse(res, error, 'Không thể kết thúc live Facebook.');
  }
});

app.get('/auth/tiktok/start', (_req, res) => {
  if (
    !ensureEnvForOAuth(
      res,
      [
        {name: 'TIKTOK_CLIENT_KEY', value: TIKTOK_CLIENT_KEY},
        {name: 'TIKTOK_CLIENT_SECRET', value: TIKTOK_CLIENT_SECRET},
        {name: 'TIKTOK_REDIRECT_URI', value: TIKTOK_REDIRECT_URI},
      ],
      'tiktok',
    )
  ) {
    return;
  }

  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', TIKTOK_CLIENT_KEY);
  url.searchParams.set('redirect_uri', TIKTOK_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user.info.basic');
  url.searchParams.set('state', createState('tiktok'));

  res.redirect(url.toString());
});

app.get('/auth/tiktok/callback', async (req, res) => {
  const {code, error, state} = req.query;
  const parsedState = parseState(state);

  if (error) {
    redirectToApp(res, {
      platform: 'tiktok',
      status: 'error',
      errorCode: error,
      errorMessage: 'Người dùng đã hủy hoặc TikTok từ chối đăng nhập.',
    });
    return;
  }

  if (!code || parsedState?.platform !== 'tiktok') {
    redirectToApp(res, {
      platform: 'tiktok',
      status: 'error',
      errorCode: 'invalid_callback',
      errorMessage: 'Callback TikTok không hợp lệ.',
    });
    return;
  }

  try {
    const tokenData = await postForm(
      'https://open.tiktokapis.com/v2/oauth/token/',
      {
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_REDIRECT_URI,
      },
    );

    const profile = await getJson(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url',
      {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    );

    const user = profile.data?.user || {};
    const store = readTokenStore();
    store.tiktok = {
      ...store.tiktok,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || '',
      expiresIn: tokenData.expires_in,
      openId: tokenData.open_id || user.open_id || '',
      scope: tokenData.scope,
      tokenType: tokenData.token_type,
      obtainedAt: new Date().toISOString(),
      profile: {
        id: user.open_id || tokenData.open_id || '',
        name: user.display_name || 'TikTok Account',
        picture: user.avatar_url || '',
      },
      updatedAt: new Date().toISOString(),
    };

    writeTokenStore(store);

    redirectToApp(res, {
      platform: 'tiktok',
      status: 'success',
      accountName: store.tiktok.profile.name,
      accountId: store.tiktok.profile.id,
    });
  } catch (oauthError) {
    redirectToApp(res, {
      platform: 'tiktok',
      status: 'error',
      errorCode: 'tiktok_exchange_failed',
      errorMessage: oauthError.message,
    });
  }
});


app.get('/live/youtube/build-info', (_req, res) => {
  res.json({
    ok: true,
    backendBuild: YOUTUBE_LOW_DELAY_BACKEND_BUILD,
    expectedLatencyPreference: 'ultraLow',
  });
});

app.get('/live/youtube/eligibility', async (req, res) => {
  try {
    const store = readTokenStore();
    const record = ensureConnectedPlatform(res, 'youtube', store);

    if (!record) {
      return;
    }

    if (!ensureValidSetupToken(req, res, record, 'youtube')) {
      return;
    }

    const accessToken = await ensureYouTubeAccessToken(store);
    const snapshot = await getYouTubeChannelSnapshot(accessToken);
    const probe = await probeYouTubeLiveEnabled(accessToken);

    store.youtube = {
      ...store.youtube,
      channel: snapshot,
      profile: {
        ...(store.youtube?.profile || {}),
        id: snapshot.channelId || store.youtube?.profile?.id || '',
        name:
          snapshot.channelTitle ||
          store.youtube?.profile?.name ||
          'YouTube Account',
        subscriberCount: snapshot.subscriberCount,
        hiddenSubscriberCount: snapshot.hiddenSubscriberCount,
      },
      updatedAt: new Date().toISOString(),
    };
    writeTokenStore(store);

    res.json(
      buildYouTubeEligibilityPayload({
        store,
        snapshot,
        liveEnabled: probe.liveEnabled,
        liveEnabledReason: probe.liveEnabledReason,
      }),
    );
  } catch (error) {
    toErrorResponse(res, error, 'Không thể kiểm tra điều kiện YouTube.');
  }
});

app.post('/live/youtube/create', async (req, res) => {
  try {
    console.log('[YouTube Live Create] request received', {
      hasAuthorization: Boolean(req.get('authorization')),
      hasSetupHeader: Boolean(req.get('x-livestream-setup-token')),
      title: req.body?.title || '',
      privacyStatus: req.body?.privacyStatus || '',
    });

    const store = readTokenStore();
    const record = ensureConnectedPlatform(res, 'youtube', store);

    console.log('[YouTube Live Create] token exists=' + Boolean(record?.accessToken || record?.refreshToken), {
      hasAccessToken: Boolean(record?.accessToken),
      hasRefreshToken: Boolean(record?.refreshToken),
      hasSetupToken: Boolean(record?.setupToken),
    });

    if (!record) {
      return;
    }

    if (!ensureValidSetupToken(req, res, record, 'youtube')) {
      console.log('[YouTube Live Create] rejected invalid setup token');
      return;
    }

    const accessToken = await ensureYouTubeAccessToken(store);

    const {
      title,
      description = '',
      privacyStatus = 'public',
      scheduledStartTime,
      enableAutoStart = false,
      enableAutoStop = false,
      enableDvr = false,
      recordFromStart = false,
      latencyPreference = 'ultraLow',
      resolution = 'variable',
      frameRate = 'variable',
    } = req.body || {};

    if (!title || !String(title).trim()) {
      res.status(400).json({
        ok: false,
        message: 'Thiếu tiêu đề phiên live YouTube.',
      });
      return;
    }

    const normalizedStartTime = normalizeIsoDate(scheduledStartTime);

    console.log('[YouTube Live Create] inserting broadcast');
    const broadcast = await postJson(
      buildYouTubeApiUrl('/youtube/v3/liveBroadcasts', {
        part: 'snippet,contentDetails,status',
      }),
      {
        snippet: {
          title: String(title).trim(),
          description: String(description || ''),
          scheduledStartTime: normalizedStartTime,
        },
        contentDetails: buildYouTubeBroadcastContentDetails({
          enableAutoStart,
          enableAutoStop,
          enableDvr,
          recordFromStart,
          latencyPreference,
        }),
        status: {
          privacyStatus: normalizeYouTubePrivacy(privacyStatus),
          selfDeclaredMadeForKids: false,
        },
      },
      {
        Authorization: `Bearer ${accessToken}`,
      },
    );

    console.log('[YouTube Live Create] inserting stream');
    const stream = await postJson(
      buildYouTubeApiUrl('/youtube/v3/liveStreams', {
        part: 'snippet,cdn,contentDetails,status',
      }),
      {
        snippet: {
          title: `${String(title).trim()} Stream`,
          description: String(description || ''),
        },
        cdn: {
          ingestionType: 'rtmp',
          resolution,
          frameRate,
        },
        contentDetails: {
          isReusable: false,
        },
      },
      {
        Authorization: `Bearer ${accessToken}`,
      },
    );

    console.log('[YouTube Live Create] binding broadcast');
    let boundBroadcast = await fetch(
      buildYouTubeApiUrl('/youtube/v3/liveBroadcasts/bind', {
        id: broadcast.id,
        part: 'id,snippet,contentDetails,status',
        streamId: stream.id,
      }),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    ).then(parseResponse);

    const desiredLatencyPreference = normalizeYouTubeLatencyPreference(latencyPreference);
    if (desiredLatencyPreference === 'ultraLow' && !isYouTubeUltraLowLatencyApplied(boundBroadcast)) {
      console.warn('[YouTube Live Create] ultraLow not applied after bind; retrying contentDetails update', {
        broadcastId: broadcast.id,
        returnedLatencyPreference: boundBroadcast.contentDetails?.latencyPreference,
        returnedEnableLowLatency: boundBroadcast.contentDetails?.enableLowLatency,
      });

      try {
        boundBroadcast = await updateYouTubeBroadcastLatency({
          accessToken,
          broadcastId: broadcast.id,
          enableAutoStart,
          enableAutoStop,
          enableDvr,
          recordFromStart,
          latencyPreference: desiredLatencyPreference,
        });
      } catch (latencyError) {
        console.warn('[YouTube Live Create] ultraLow update failed; retrying low latency fallback', {
          broadcastId: broadcast.id,
          message: latencyError?.message || String(latencyError),
        });

        boundBroadcast = await updateYouTubeBroadcastLatency({
          accessToken,
          broadcastId: broadcast.id,
          enableAutoStart,
          enableAutoStop,
          enableDvr,
          recordFromStart,
          latencyPreference: 'low',
        });
      }
    }

    console.log('[YouTube Live Create] latency applied', {
      broadcastId: broadcast.id,
      latencyPreference: boundBroadcast.contentDetails?.latencyPreference,
      enableLowLatency: boundBroadcast.contentDetails?.enableLowLatency,
      enableDvr: boundBroadcast.contentDetails?.enableDvr,
    });

    const ingestion = stream.cdn?.ingestionInfo || {};
    const ingestBase =
      ingestion.rtmpsIngestionAddress ||
      ingestion.ingestionAddress ||
      '';
    const streamName = ingestion.streamName || '';

    const session = {
      id: broadcast.id,
      broadcastId: broadcast.id,
      streamId: stream.id,
      title: boundBroadcast.snippet?.title || String(title).trim(),
      description: boundBroadcast.snippet?.description || String(description),
      privacyStatus:
        boundBroadcast.status?.privacyStatus ||
        normalizeYouTubePrivacy(privacyStatus),
      scheduledStartTime:
        boundBroadcast.snippet?.scheduledStartTime || normalizedStartTime,
      streamUrl: ingestBase,
      streamName,
      streamUrlWithKey:
        ingestBase && streamName ? `${ingestBase}/${streamName}` : '',
      watchUrl: `https://www.youtube.com/watch?v=${broadcast.id}`,
      streamStatus: stream.status?.streamStatus || '',
      broadcastStatus: boundBroadcast.status?.lifeCycleStatus || '',
      latencyPreference:
        boundBroadcast.contentDetails?.latencyPreference ||
        normalizeYouTubeLatencyPreference(latencyPreference),
      enableLowLatency:
        boundBroadcast.contentDetails?.enableLowLatency ??
        (desiredLatencyPreference === 'low'
          ? true
          : desiredLatencyPreference === 'normal'
            ? false
            : null),
      enableDvr: boundBroadcast.contentDetails?.enableDvr ?? Boolean(enableDvr),
      enableAutoStop:
        boundBroadcast.contentDetails?.enableAutoStop ?? Boolean(enableAutoStop),
      backendBuild: YOUTUBE_LOW_DELAY_BACKEND_BUILD,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    upsertLiveSession(store, 'youtube', broadcast.id, session);
    writeTokenStore(store);
    scheduleYouTubeAutoGoLive({
      broadcastId: broadcast.id,
      streamId: stream.id,
    });

    console.log('[YouTube Live Create] success broadcastId=' + broadcast.id + ' streamId=' + stream.id, {
      hasStreamUrl: Boolean(ingestBase),
      hasStreamName: Boolean(streamName),
    });

    res.json({
      ok: true,
      platform: 'youtube',
      session,
      raw: {
        broadcast: boundBroadcast,
        stream,
      },
    });
  } catch (error) {
    console.log('[YouTube Live Create] error', {
      message: error?.message || '',
      status: error?.status || error?.statusCode || '',
      body: error?.body || error?.response || '',
    });
    const message = error?.message || 'Không thể tạo phiên live YouTube.';
    if (
      message.includes('not enabled for live streaming') ||
      message.includes('liveStreamingNotEnabled')
    ) {
      try {
        const store = readTokenStore();
        const accessToken = await ensureYouTubeAccessToken(store);
        const snapshot = await getYouTubeChannelSnapshot(accessToken);

        res.status(400).json({
          ...buildYouTubeEligibilityPayload({
            store,
            snapshot,
            liveEnabled: false,
            liveEnabledReason: 'YouTube báo kênh hiện chưa được bật quyền livestream.',
          }),
          ok: false,
          errorCode: 'youtube_live_not_enabled',
          message,
        });
        return;
      } catch (_eligibilityError) {
        // Fall through to generic error response
      }
    }

    toErrorResponse(res, error, 'Không thể tạo phiên live YouTube.');
  }
});

app.get('/live/youtube/status/:broadcastId', async (req, res) => {
  try {
    const store = readTokenStore();
    const record = ensureConnectedPlatform(res, 'youtube', store);

    if (!record) {
      return;
    }

    if (!ensureValidSetupToken(req, res, record, 'youtube')) {
      return;
    }

    const accessToken = await ensureYouTubeAccessToken(store);
    const {broadcastId} = req.params;
    const storedSession = store.youtube?.liveSessions?.[broadcastId];

    const streamId = storedSession?.streamId;

    const result = await tryAutoTransitionYouTubeBroadcast({
      store,
      accessToken,
      broadcastId,
      streamId,
    });

    res.json({
      ok: true,
      broadcast: result.broadcast,
      stream: result.stream,
      autoTransitioned: result.transitioned,
    });
  } catch (error) {
    toErrorResponse(res, error, 'Không thể lấy trạng thái live YouTube.');
  }
});

app.post('/live/youtube/go-live', async (req, res) => {
  try {
    const store = readTokenStore();
    const record = ensureConnectedPlatform(res, 'youtube', store);

    if (!record) {
      return;
    }

    if (!ensureValidSetupToken(req, res, record, 'youtube')) {
      return;
    }

    const accessToken = await ensureYouTubeAccessToken(store);
    const {broadcastId} = req.body || {};

    if (!broadcastId) {
      res.status(400).json({
        ok: false,
        message: 'Thiếu broadcastId YouTube.',
      });
      return;
    }

    const session = store.youtube?.liveSessions?.[broadcastId];
    const result = await tryAutoTransitionYouTubeBroadcast({
      store,
      accessToken,
      broadcastId,
      streamId: session?.streamId,
    });

    res.json({
      ok: true,
      broadcast: result.broadcast,
      stream: result.stream,
      autoTransitioned: result.transitioned,
    });
  } catch (error) {
    toErrorResponse(res, error, 'Không thể chuyển live YouTube sang trạng thái phát chính thức.');
  }
});

app.post('/live/youtube/stop', async (req, res) => {
  try {
    const store = readTokenStore();
    const record = ensureConnectedPlatform(res, 'youtube', store);

    if (!record) {
      return;
    }

    if (!ensureValidSetupToken(req, res, record, 'youtube')) {
      return;
    }

    const accessToken = await ensureYouTubeAccessToken(store);
    const {broadcastId} = req.body || {};

    if (!broadcastId) {
      res.status(400).json({
        ok: false,
        message: 'Thiếu broadcastId YouTube.',
      });
      return;
    }

    const stopped = await fetch(
      buildYouTubeApiUrl('/youtube/v3/liveBroadcasts/transition', {
        broadcastStatus: 'complete',
        id: broadcastId,
        part: 'id,snippet,contentDetails,status',
      }),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    ).then(parseResponse);

    cancelYouTubeAutoGoLive(broadcastId);
    removeLiveSession(store, 'youtube', broadcastId);
    writeTokenStore(store);

    res.json({
      ok: true,
      broadcast: stopped,
    });
  } catch (error) {
    toErrorResponse(res, error, 'Không thể kết thúc live YouTube.');
  }
});

app.listen(PORT, () => {
  console.log(`Livestream auth + live server listening on port ${PORT}`);
  console.log(`App callback: ${APP_CALLBACK_URL}`);
});
