import {Platform} from 'react-native';

// Local backend dùng khi chạy debug trên máy dev.
// Nếu backend local không chạy cùng máy Windows app, đổi localhost thành IP LAN của máy chạy BE.
export const APLUS_LIVE_SCORE_DEV_API_BASE_URL =
  'http://127.0.0.1:5000/api/live';

// URL production sau khi deploy backend Aplus.
// Khi đưa lên hosting thật, đảm bảo backend đã mount /api/live và có LIVE_SCORE_API_KEY giống key bên dưới.
export const APLUS_LIVE_SCORE_RELEASE_API_BASE_URL =
  'https://aplusbilliards.vn/api/live';

export const APLUS_LIVE_SCORE_API_BASE_URL = Platform.OS === 'windows'
  ? __DEV__
    ? APLUS_LIVE_SCORE_DEV_API_BASE_URL
    : APLUS_LIVE_SCORE_RELEASE_API_BASE_URL
  : __DEV__
    ? APLUS_LIVE_SCORE_DEV_API_BASE_URL
    : APLUS_LIVE_SCORE_RELEASE_API_BASE_URL;

// Batch 5: để key local trùng với BE/.env đang test.
// Khi deploy production, đổi giá trị này để trùng LIVE_SCORE_API_KEY trên hosting.
export const APLUS_LIVE_SCORE_API_KEY = 'aplus_live_score_secret_key';

export const APLUS_LIVE_SCORE_REQUEST_TIMEOUT_MS = 10000;

export const APLUS_LIVE_SCORE_DEVICE_ID_STORAGE_KEY =
  '@aplus_live_score_device_id';

export const APLUS_LIVE_SCORE_DEVICE_NAME_STORAGE_KEY =
  '@aplus_live_score_device_name';

export const APLUS_LIVE_SCORE_SESSION_STORAGE_KEY =
  '@aplus_live_score_session';

export const normalizeAplusLiveScoreBaseUrl = (value: string) =>
  value.trim().replace(/\/+$/, '');

export const isConfiguredAplusLiveScoreBaseUrl = (value: string) => {
  if (!value) {
    return false;
  }

  if (
    value.includes('YOUR_APLUS_LIVE_SCORE_BACKEND_URL') ||
    value.includes('example.com')
  ) {
    return false;
  }

  return /^https?:\/\/.+/i.test(value);
};
