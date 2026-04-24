import images from 'assets';

export type FlagPlayerLike = {
  flag?: string;
  countryCode?: string;
  countryName?: string;
  flagImage?: string;
  image?: string;
  name?: string;
};

export const DEFAULT_COUNTRY_CODE = 'VN';
export const DEFAULT_COUNTRY_NAME = 'Việt Nam';

const normalize = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase();

export const normalizePlayerCountry = <T extends FlagPlayerLike>(
  player?: T | null,
): T & Required<Pick<FlagPlayerLike, 'countryCode' | 'countryName' | 'flag'>> => {
  const target = (player || {}) as T;

  return {
    ...target,
    countryCode: target.countryCode || DEFAULT_COUNTRY_CODE,
    countryName: target.countryName || DEFAULT_COUNTRY_NAME,
    flag: target.flag || target.countryCode || DEFAULT_COUNTRY_CODE,
  };
};

export const isVietnamPlayer = (player?: FlagPlayerLike | null) => {
  const target = normalizePlayerCountry(player);
  const flag = normalize(target.flag);
  const code = normalize(target.countryCode);
  const name = normalize(target.countryName);

  return (
    code === 'vn' ||
    code === 'vnm' ||
    code === 'vi' ||
    flag === 'vn' ||
    flag === 'vnm' ||
    flag === '🇻🇳' ||
    flag.includes('vietnam') ||
    flag.includes('viet nam') ||
    flag.includes('việt nam') ||
    name.includes('vietnam') ||
    name.includes('viet nam') ||
    name.includes('việt nam')
  );
};

export const getFlagImageSource = (player?: FlagPlayerLike | null): any | null => {
  const target = normalizePlayerCountry(player);
  const directImage = target.flagImage || target.image;

  if (directImage && /^https?:\/\//i.test(String(directImage))) {
    return {uri: String(directImage)};
  }

  if (isVietnamPlayer(target)) {
    return images.vietnam;
  }

  const code = String(target.countryCode || target.flag || '')
    .trim()
    .toLowerCase();

  if (/^[a-z]{2}$/.test(code)) {
    return {uri: `https://flagcdn.com/w80/${code}.png`};
  }

  return null;
};

export const getFlagText = (player?: FlagPlayerLike | null) => {
  const target = normalizePlayerCountry(player);

  if (getFlagImageSource(target)) {
    return '';
  }

  return String(target.flag || target.countryCode || '').trim();
};

export const getWindowsFlagImageSource = getFlagImageSource;
export const getWindowsFlagText = getFlagText;
export const getWindowsOverlayFlag = getFlagText;