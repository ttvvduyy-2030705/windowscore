import {Platform} from 'react-native';

export const LIVESTREAM_AUTH_DEV_BASE_URL =
  'https://vania-worthwhile-ontogenetically.ngrok-free.dev';

export const LIVESTREAM_AUTH_RELEASE_BASE_URL =
  'https://aplus-live-backend.onrender.com';

// Windows OAuth/live creation must not use the dev ngrok URL.
// Even in run-windows debug, use the production backend for OAuth callback + YouTube Live API.
// The actual video stream still goes local PC -> FFmpeg -> YouTube RTMP, not through Render/ngrok/Metro.
export const LIVESTREAM_AUTH_BASE_URL = Platform.OS === 'windows'
  ? LIVESTREAM_AUTH_RELEASE_BASE_URL
  : __DEV__
    ? LIVESTREAM_AUTH_DEV_BASE_URL
    : LIVESTREAM_AUTH_RELEASE_BASE_URL;

export const APP_OAUTH_SCHEME = 'aplusscore';
export const APP_OAUTH_HOST = 'oauth';
export const APP_OAUTH_PATH = '/callback';

export const APP_OAUTH_CALLBACK_URL = `${APP_OAUTH_SCHEME}://${APP_OAUTH_HOST}${APP_OAUTH_PATH}`;

export const LIVESTREAM_ACCOUNT_STORAGE_KEY = '@livestream_platform_setup';

export const normalizeLivestreamBaseUrl = (value: string) =>
  value.trim().replace(/\/+$/, '');

export const isConfiguredLivestreamBaseUrl = (value: string) => {
  if (!value) {
    return false;
  }

  if (
    value.includes('YOUR_PUBLIC_BACKEND_OR_NGROK_URL') ||
    value.includes('YOUR_PRODUCTION_LIVESTREAM_BACKEND_URL')
  ) {
    return false;
  }

  if (Platform.OS === 'windows' && /ngrok/i.test(value)) {
    return false;
  }

  if (!__DEV__ && /ngrok/i.test(value)) {
    return false;
  }

  return /^https?:\/\/.+/i.test(value);
};
