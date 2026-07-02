import AsyncStorage from '@react-native-async-storage/async-storage';
import {keys} from 'configuration/keys';

export type IpCameraTemplate = 'imou_dahua';

export type IpCameraConfig = {
  enabled: boolean;
  name: string;
  ipAddress: string;
  username: string;
  password: string;
  port: string;
  channel: string;
  subtype: string;
  template: IpCameraTemplate;
  /** Kept only so old saved data does not break. Android UI no longer uses custom RTSP. */
  customRtspUrl: string;
};

export const DEFAULT_IP_CAMERA_CONFIG: IpCameraConfig = {
  enabled: false,
  name: '',
  ipAddress: '',
  username: 'admin',
  password: '',
  port: '554',
  channel: '1',
  subtype: '0',
  template: 'imou_dahua',
  customRtspUrl: '',
};

export const IP_CAMERA_TEMPLATES: Record<
  IpCameraTemplate,
  {
    label: string;
    username: string;
    port: string;
    channel: string;
    subtype: string;
    paths: string[];
  }
> = {
  imou_dahua: {
    label: 'Imou / Dahua',
    username: 'admin',
    port: '554',
    channel: '1',
    subtype: '0',
    paths: [
      '/cam/realmonitor?channel={channel}&subtype=0',
      '/cam/realmonitor?channel={channel}&subtype=1',
      '/live/ch00_0',
      '/live/ch00_1',
    ],
  },
};

const clean = (value?: string | null) => String(value || '').trim();

const unique = <T,>(items: T[]): T[] => Array.from(new Set(items));

const normalizeIp = (value?: string | null) => {
  const raw = clean(value);
  if (!raw) {
    return '';
  }

  // UI chỉ cần IP camera. Nếu người dùng lỡ dán URL/port/path thì vẫn bóc ra IP.
  const withoutProtocol = raw.replace(/^rtsp:\/\//i, '').replace(/^https?:\/\//i, '');
  const withoutAuth = withoutProtocol.includes('@')
    ? withoutProtocol.split('@').pop() || ''
    : withoutProtocol;
  const hostPort = withoutAuth.split('/')[0].split('?')[0];
  return hostPort.replace(/:\d+$/i, '').trim();
};

const getTemplate = (_value?: string | null) => IP_CAMERA_TEMPLATES.imou_dahua;

const buildUrl = (
  ipAddress: string,
  username: string,
  password: string,
  port: string,
  path: string,
  encodePassword: boolean,
) => {
  const authUser = encodeURIComponent(username);
  const authPassword = encodePassword ? encodeURIComponent(password) : password;
  return `rtsp://${authUser}:${authPassword}@${ipAddress}:${port}${path}`;
};

export const normalizeIpCameraConfig = (
  raw?: Partial<IpCameraConfig> | null,
): IpCameraConfig => {
  const template = getTemplate(raw?.template);

  return {
    enabled: raw?.enabled === true || String((raw as any)?.enabled || '') === 'true',
    name: clean(raw?.name),
    ipAddress: normalizeIp(raw?.ipAddress),
    username: template.username,
    password: String(raw?.password || '').trim(),
    port: template.port,
    channel: template.channel,
    subtype: template.subtype,
    template: 'imou_dahua',
    customRtspUrl: String(raw?.customRtspUrl || '').trim(),
  };
};

export const isIpCameraConfigured = (config?: Partial<IpCameraConfig> | null) => {
  const normalized = normalizeIpCameraConfig(config || undefined);
  return Boolean(
    normalized.enabled &&
      ((normalized.ipAddress && normalized.password) || /^rtsp:\/\//i.test(normalized.customRtspUrl))
  );
};

export const buildRtspCameraCandidates = (
  config?: Partial<IpCameraConfig> | null,
): string[] => {
  const normalized = normalizeIpCameraConfig(config || undefined);
  const custom = clean(normalized.customRtspUrl);
  if (custom && /^rtsp:\/\//i.test(custom)) {
    return [custom];
  }

  if (!normalized.ipAddress || !normalized.password) {
    return [];
  }

  const template = getTemplate(normalized.template);
  const paths = template.paths.map(path =>
    path
      .replace('{channel}', template.channel)
      .replace('{subtype}', template.subtype),
  );

  const encodedUrls = paths.map(path =>
    buildUrl(
      normalized.ipAddress,
      template.username,
      normalized.password,
      template.port,
      path,
      true,
    ),
  );

  // Một số firmware RTSP xử lý password raw ổn hơn encoded. Safety Code Imou thường
  // là chữ/số nên hai URL sẽ trùng và được unique loại bỏ.
  const rawUrls = paths.map(path =>
    buildUrl(
      normalized.ipAddress,
      template.username,
      normalized.password,
      template.port,
      path,
      false,
    ),
  );

  return unique([...encodedUrls, ...rawUrls]);
};

export const buildRtspCameraUrl = (config?: Partial<IpCameraConfig> | null) => {
  return buildRtspCameraCandidates(config)[0] || '';
};

export const maskRtspCameraUrl = (url?: string | null) => {
  const value = clean(url);
  if (!value) {
    return '';
  }
  return value.replace(/rtsp:\/\/([^:]+):([^@]+)@/i, 'rtsp://$1:***@');
};

export const loadIpCameraConfig = async (): Promise<IpCameraConfig> => {
  const values = await AsyncStorage.multiGet([
    keys.IP_CAMERA_ENABLED,
    keys.IP_CAMERA_NAME,
    keys.IP_CAMERA_IP_ADDRESS,
    keys.IP_CAMERA_PASSWORD,
    keys.IP_CAMERA_CUSTOM_RTSP_URL,
  ]);

  const byKey = values.reduce<Record<string, string | null>>((result, [key, value]) => {
    result[key] = value;
    return result;
  }, {});

  return normalizeIpCameraConfig({
    enabled: byKey[keys.IP_CAMERA_ENABLED] === 'true',
    name: byKey[keys.IP_CAMERA_NAME] || '',
    ipAddress: byKey[keys.IP_CAMERA_IP_ADDRESS] || '',
    password: byKey[keys.IP_CAMERA_PASSWORD] || '',
    customRtspUrl: byKey[keys.IP_CAMERA_CUSTOM_RTSP_URL] || '',
  });
};

export const saveIpCameraConfig = async (config: IpCameraConfig) => {
  const normalized = normalizeIpCameraConfig(config);

  await AsyncStorage.multiSet([
    [keys.IP_CAMERA_ENABLED, normalized.enabled ? 'true' : 'false'],
    [keys.IP_CAMERA_NAME, normalized.name],
    [keys.IP_CAMERA_IP_ADDRESS, normalized.ipAddress],
    [keys.IP_CAMERA_USERNAME, normalized.username],
    [keys.IP_CAMERA_PASSWORD, normalized.password],
    [keys.IP_CAMERA_PORT, normalized.port],
    [keys.IP_CAMERA_CHANNEL, normalized.channel],
    [keys.IP_CAMERA_SUBTYPE, normalized.subtype],
    [keys.IP_CAMERA_CUSTOM_RTSP_URL, normalized.customRtspUrl],
  ]);

  return normalized;
};

export const clearIpCameraConfig = async () => {
  await AsyncStorage.multiRemove([
    keys.IP_CAMERA_ENABLED,
    keys.IP_CAMERA_NAME,
    keys.IP_CAMERA_IP_ADDRESS,
    keys.IP_CAMERA_USERNAME,
    keys.IP_CAMERA_PASSWORD,
    keys.IP_CAMERA_PORT,
    keys.IP_CAMERA_CHANNEL,
    keys.IP_CAMERA_SUBTYPE,
    keys.IP_CAMERA_CUSTOM_RTSP_URL,
  ]);
};
