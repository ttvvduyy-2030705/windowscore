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

const isRemoteUri = (value?: string | null) =>
  /^https?:\/\//i.test(String(value || '').trim()) ||
  /^file:\/\//i.test(String(value || '').trim());

export const getCountryCodeFromFlagEmoji = (value?: string | null) => {
  const chars = Array.from(String(value || '').trim());
  if (chars.length !== 2) {
    return '';
  }

  const code = chars
    .map(char => {
      const point = char.codePointAt(0) || 0;
      if (point < 0x1f1e6 || point > 0x1f1ff) {
        return '';
      }
      return String.fromCharCode(point - 0x1f1e6 + 65);
    })
    .join('');

  return /^[A-Z]{2}$/.test(code) ? code : '';
};

export const getCountryCodeFromPlayer = (player?: FlagPlayerLike | null) => {
  const target = player || {};
  const directCode = String(target.countryCode || '')
    .trim()
    .toUpperCase();
  if (/^[A-Z]{2}$/.test(directCode)) {
    return directCode;
  }

  const rawFlag = String(target.flag || '').trim();
  const flagAsCode = rawFlag.toUpperCase();
  if (/^[A-Z]{2}$/.test(flagAsCode)) {
    return flagAsCode;
  }

  const emojiCode = getCountryCodeFromFlagEmoji(rawFlag);
  if (emojiCode) {
    return emojiCode;
  }

  const name = normalize(target.countryName);
  if (
    name.includes('vietnam') ||
    name.includes('viet nam') ||
    name.includes('việt nam')
  ) {
    return 'VN';
  }

  return '';
};

export const normalizePlayerCountry = <T extends FlagPlayerLike>(
  player?: T | null,
): T & Required<Pick<FlagPlayerLike, 'countryCode' | 'countryName' | 'flag'>> => {
  const target = (player || {}) as T;
  const code = getCountryCodeFromPlayer(target) || DEFAULT_COUNTRY_CODE;

  return {
    ...target,
    countryCode: target.countryCode || code,
    countryName: target.countryName || (code === 'VN' ? DEFAULT_COUNTRY_NAME : ''),
    flag: target.flag || code,
  };
};

export const isVietnamPlayer = (player?: FlagPlayerLike | null) => {
  const target = normalizePlayerCountry(player);
  const code = getCountryCodeFromPlayer(target);
  const flag = normalize(target.flag);
  const name = normalize(target.countryName);

  return (
    code === 'VN' ||
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

  if (directImage && isRemoteUri(directImage)) {
    return {uri: String(directImage)};
  }

  if (isVietnamPlayer(target)) {
    return images.vietnam;
  }

  const code = getCountryCodeFromPlayer(target).toLowerCase();
  if (/^[a-z]{2}$/.test(code)) {
    return {uri: `https://flagcdn.com/w160/${code}.png`};
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
