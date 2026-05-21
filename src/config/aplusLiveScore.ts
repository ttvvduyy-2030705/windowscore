import {Platform} from 'react-native';

// Sidecar API live score riêng, không cần quyền sửa VPS API cũ của dev.
// Sidecar sẽ tự proxy dữ liệu giải/trận từ API cũ:
// https://api-aplus.180.93.36.239.nip.io/api
//
// Debug local: chạy aplus-live-sidecar-api ở máy dev bằng port 5010.
export const APLUS_LIVE_SCORE_DEV_API_BASE_URL =
  'https://live-api.103.138.88.55.nip.io/api/live';

// Production: thay URL này bằng domain thật nơi deploy aplus-live-sidecar-api.
// Ví dụ: https://live-api.aplusbilliards.vn/api/live
export const APLUS_LIVE_SCORE_RELEASE_API_BASE_URL =
  'https://live-api.103.138.88.55.nip.io/api/live';

export const APLUS_LIVE_SCORE_API_BASE_URL = Platform.OS === 'windows'
  ? __DEV__
    ? APLUS_LIVE_SCORE_DEV_API_BASE_URL
    : APLUS_LIVE_SCORE_RELEASE_API_BASE_URL
  : __DEV__
    ? APLUS_LIVE_SCORE_DEV_API_BASE_URL
    : APLUS_LIVE_SCORE_RELEASE_API_BASE_URL;

// Key này phải trùng với LIVE_SCORE_API_KEY trong sidecar API.
export const APLUS_LIVE_SCORE_API_KEY = 'jahsd82ohehbcfjbsc89ay3wbejkhdbc982ybkejhbcf8dasjchbkjf92jdfi8ow2i';

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
    value.includes('YOUR_LIVE_SIDECAR_DOMAIN') ||
    value.includes('YOUR_APLUS_LIVE_SCORE_BACKEND_URL') ||
    value.includes('example.com')
  ) {
    return false;
  }

  return /^https?:\/\/.+/i.test(value);
};
