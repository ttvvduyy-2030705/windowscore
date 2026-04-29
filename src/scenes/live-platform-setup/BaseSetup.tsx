import AsyncStorage from '@react-native-async-storage/async-storage';
import {useFocusEffect} from '@react-navigation/native';
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import images from 'assets';
import AppImage from 'components/Image';
import Container from 'components/Container';
import Text from 'components/Text';
import {LIVESTREAM_ACCOUNT_STORAGE_KEY} from 'config/livestreamAuth';
import useAdaptiveLayout from 'scenes/game/useAdaptiveLayout';
import useScreenSystemUI from 'theme/systemUI';
import {screens} from 'scenes/screens';
import createBrandedScreenChrome from 'scenes/shared/createBrandedScreenChrome';
import getBrandedScreenMetrics from 'scenes/shared/getBrandedScreenMetrics';
import {
  openPlatformOAuth,
  parseOAuthCallback,
  type LivestreamPlatform,
} from 'services/livestreamAuth';
import {Navigation} from 'types/navigation';
import {useAplusPro} from 'features/subscription';

import {CURRENT_PLATFORM_KEY} from '../live-platform';

type LivePlatformSetupRouteParams = {
  livestreamPlatform?: 'facebook' | 'youtube' | 'tiktok';
  saveToDeviceWhileStreaming?: boolean;
  setupToken?: string;
};

export interface Props extends Navigation, LivePlatformSetupRouteParams {
  route?: {
    params?: LivePlatformSetupRouteParams;
  };
}

type Platform = 'facebook' | 'youtube' | 'tiktok';
type Visibility = 'public' | 'private' | 'unlisted';

type StoredSetup = {
  accountName?: string;
  accountId?: string;
  visibility?: Visibility;
  setupToken?: string;
};

type StorageShape = {
  facebook?: StoredSetup;
  youtube?: StoredSetup;
  tiktok?: StoredSetup;
};


const OAUTH_CALLBACK_DEDUPE_TTL_MS = 5 * 60 * 1000;
const handledOAuthCallbackUrls = new Map<string, number>();
const handledOAuthSuccessKeys = new Map<string, number>();

const pruneOAuthDedupeCache = () => {
  const now = Date.now();
  handledOAuthCallbackUrls.forEach((timestamp, key) => {
    if (now - timestamp > OAUTH_CALLBACK_DEDUPE_TTL_MS) {
      handledOAuthCallbackUrls.delete(key);
    }
  });
  handledOAuthSuccessKeys.forEach((timestamp, key) => {
    if (now - timestamp > OAUTH_CALLBACK_DEDUPE_TTL_MS) {
      handledOAuthSuccessKeys.delete(key);
    }
  });
};

const shouldProcessOAuthCallbackUrl = (url?: string | null) => {
  const callbackUrl = String(url || '').trim();
  if (!callbackUrl) {
    return false;
  }

  pruneOAuthDedupeCache();

  if (handledOAuthCallbackUrls.has(callbackUrl)) {
    return false;
  }

  handledOAuthCallbackUrls.set(callbackUrl, Date.now());
  return true;
};

const shouldShowOAuthSuccessOnce = (key: string) => {
  pruneOAuthDedupeCache();

  if (handledOAuthSuccessKeys.has(key)) {
    return false;
  }

  handledOAuthSuccessKeys.set(key, Date.now());
  return true;
};

const clearOAuthDedupeCache = () => {
  handledOAuthCallbackUrls.clear();
  handledOAuthSuccessKeys.clear();
};

const normalizePlatform = (value?: string | null): Platform | null => {
  if (value === 'facebook' || value === 'youtube' || value === 'tiktok') {
    return value;
  }
  return null;
};

const createStyles = (adaptive: ReturnType<typeof useAdaptiveLayout>) => {
  const chrome = createBrandedScreenChrome(adaptive);
  const metrics = getBrandedScreenMetrics(adaptive);

  return StyleSheet.create({
    screen: chrome.screen,
    scrollView: {flex: 1, width: '100%', alignSelf: 'stretch'},
    scrollContent: {
      flexGrow: 1,
      width: '100%',
      alignSelf: 'stretch',
      paddingHorizontal: metrics.screenPaddingX,
      paddingTop: metrics.sectionGap,
      paddingBottom: metrics.s(24),
    },
    contentInner: {width: '100%', alignSelf: 'stretch'},
    headerGlow: chrome.headerGlow,
    headerBackButton: chrome.headerBackButton,
    headerBackFrame: chrome.headerBackFrame,
    headerBackInner: chrome.headerBackInner,
    headerBackArrow: {
      color: '#FFFFFF',
      fontSize: metrics.fs(22),
      fontWeight: '900',
      marginRight: metrics.s(10),
    },
    headerBackLogoImage: chrome.headerBackLogoImage,
    headerTitleWrap: chrome.headerTitleWrap,
    headerTitle: chrome.headerTitle,
    sectionLabel: {
      color: '#FFFFFF',
      fontWeight: '800',
    },
    accountRow: {
      width: '100%',
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: metrics.s(14),
      minHeight: adaptive.s(72),
    },
    accountTextWrap: {
      marginLeft: metrics.s(16),
      flex: 1,
    },
    mutedText: {
      color: '#FFFFFF',
      marginTop: metrics.s(4),
      lineHeight: metrics.fs(18),
    },
    radioOuter: {
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#FFFFFF',
    },
    radioInner: {
      backgroundColor: '#000000',
    },
    logoutButton: {
      width: '100%',
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      borderColor: '#FF174F',
      backgroundColor: '#0A0A0A',
    },
    optionRow: {
      width: '100%',
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: adaptive.s(54),
    },
    optionLabel: {
      marginLeft: metrics.s(16),
      color: '#FFFFFF',
      fontWeight: '600',
    },
    continueButton: {
      width: '100%',
      alignSelf: 'stretch',
      backgroundColor: '#FF174F',
      alignItems: 'center',
      justifyContent: 'center',
    },
    continueText: {
      color: '#FFFFFF',
      textAlign: 'center',
    },
    primaryText: {
      color: '#FFFFFF',
    },
    logoutText: {
      color: '#FFFFFF',
      textAlign: 'center',
    },
  });
};

const LivePlatformSetup = (props: Props) => {
  useScreenSystemUI({variant: 'fullscreen', barStyle: 'light-content'});
  const adaptive = useAdaptiveLayout();
  const styles = useMemo(() => createStyles(adaptive), [adaptive.styleKey]);
  const metrics = useMemo(() => getBrandedScreenMetrics(adaptive), [adaptive.styleKey]);

  const routeParams = (props.route?.params || props || {}) as LivePlatformSetupRouteParams;
  const saveToDeviceWhileStreaming =
    routeParams.saveToDeviceWhileStreaming || false;

  const [platform, setPlatform] = useState<Platform>('youtube');
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');

  const autoAuthTriggeredRef = useRef(false);
  const latestOAuthSuccessKeyRef = useRef('');
  const {isAplusProActive, showPaywall} = useAplusPro();

  const compact = !adaptive.isLandscape || adaptive.width < 1100;

  const ui = useMemo(() => {
    return {
      horizontalPadding: metrics.screenPaddingX,
      sectionGap: metrics.sectionGap,
      titleSize: metrics.fs(compact ? 15 : 19),
      bodySize: metrics.fs(compact ? 13 : 17),
      subSize: metrics.fs(compact ? 11 : 14),
      buttonSize: metrics.fs(compact ? 14 : 17),
      buttonHeight: adaptive.s(compact ? 48 : 56),
      radioSize: adaptive.s(compact ? 22 : 28),
      optionGap: metrics.s(compact ? 12 : 18),
      boxRadius: metrics.fieldRadius,
      outlineWidth: 2,
    };
  }, [adaptive, compact, metrics]);

  const readStorage = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(LIVESTREAM_ACCOUNT_STORAGE_KEY);
      if (!raw) {
        return {} as StorageShape;
      }
      return JSON.parse(raw) as StorageShape;
    } catch (_error) {
      return {} as StorageShape;
    }
  }, []);

  const writeStorage = useCallback(async (nextValue: StorageShape) => {
    await AsyncStorage.setItem(
      LIVESTREAM_ACCOUNT_STORAGE_KEY,
      JSON.stringify(nextValue),
    );
  }, []);

  const persistLocalState = useCallback(
    async (
      nextPlatform: Platform,
      nextAccountName: string,
      nextAccountId: string,
      nextVisibility: Visibility,
      nextSetupToken?: string,
    ) => {
      const stored = await readStorage();
      const previousSetup = stored[nextPlatform];
      const resolvedSetupToken =
        nextSetupToken !== undefined
          ? nextSetupToken
          : previousSetup?.setupToken || '';
      const nextValue: StorageShape = {
        ...stored,
        [nextPlatform]: {
          ...previousSetup,
          accountName: nextAccountName,
          accountId: nextAccountId,
          visibility: nextVisibility,
          setupToken: resolvedSetupToken,
        },
      };
      await writeStorage(nextValue);
    },
    [readStorage, writeStorage],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const bootstrap = async () => {
        try {
          setIsLoading(true);

          const fromRoute = normalizePlatform(
            routeParams.livestreamPlatform,
          );
          const fromStorage = normalizePlatform(
            await AsyncStorage.getItem(CURRENT_PLATFORM_KEY),
          );
          const resolvedPlatform = fromRoute || fromStorage || 'youtube';

          if (!active) {
            return;
          }

          setPlatform(resolvedPlatform);

          const stored = await readStorage();
          const current = stored[resolvedPlatform];

          if (!active) {
            return;
          }

          setAccountName(current?.accountName || '');
          setAccountId(current?.accountId || '');
          setSetupToken(current?.setupToken || routeParams.setupToken || '');
          setVisibility(current?.visibility || 'public');
          autoAuthTriggeredRef.current = false;
        } finally {
          if (active) {
            setIsLoading(false);
          }
        }
      };

      bootstrap();

      return () => {
        active = false;
      };
    }, [
      routeParams.livestreamPlatform,
      routeParams.setupToken,
      readStorage,
    ]),
  );

  const platformName = useMemo(() => {
    switch (platform) {
      case 'facebook':
        return 'Facebook';
      case 'youtube':
        return 'YouTube';
      case 'tiktok':
        return 'TikTok';
      default:
        return 'Livestream';
    }
  }, [platform]);

  const accountSectionTitle = useMemo(() => {
    switch (platform) {
      case 'facebook':
        return 'Đổi tài khoản Facebook';
      case 'youtube':
        return 'Đổi kênh YouTube';
      case 'tiktok':
        return 'Đổi tài khoản TikTok';
      default:
        return 'Đổi tài khoản livestream';
    }
  }, [platform]);

  const accountOptionTitle = useMemo(() => {
    switch (platform) {
      case 'facebook':
        return 'Phát lên trang hoặc hồ sơ Facebook';
      case 'youtube':
        return 'Phát lên một kênh YouTube';
      case 'tiktok':
        return 'Phát lên tài khoản TikTok';
      default:
        return 'Phát lên tài khoản đã chọn';
    }
  }, [platform]);

  const emptyAccountText = useMemo(() => {
    if (isAuthorizing) {
      return `Đang mở ${platformName} để đăng nhập...`;
    }

    switch (platform) {
      case 'facebook':
        return 'Chưa đăng nhập Facebook';
      case 'youtube':
        return 'Chưa đăng nhập YouTube';
      case 'tiktok':
        return 'Chưa đăng nhập TikTok';
      default:
        return 'Chưa đăng nhập';
    }
  }, [isAuthorizing, platform, platformName]);

  const continueButtonText = useMemo(() => {
    switch (platform) {
      case 'facebook':
        return 'TIẾP TỤC VỚI FACEBOOK';
      case 'youtube':
        return 'TIẾP TỤC VỚI YOUTUBE';
      case 'tiktok':
        return 'TIẾP TỤC VỚI TIKTOK';
      default:
        return 'TIẾP TỤC';
    }
  }, [platform]);

  const headerTitle = useMemo(() => 'Thiết lập livestream', []);

  const onBack = useCallback(() => {
    if (typeof props?.goBack === 'function') {
      props.goBack();
      return;
    }

    if (typeof props?.navigation?.goBack === 'function') {
      props.navigation.goBack();
    }
  }, [props]);

  const showLivestreamPaywall = useCallback(() => {
    showPaywall(platform === 'facebook' ? 'facebook' : platform === 'youtube' ? 'youtube' : 'livestream');
  }, [platform, showPaywall]);

  const startBrowserAuth = useCallback(async () => {
    if (!isAplusProActive) {
      showLivestreamPaywall();
      return;
    }

    try {
      setIsAuthorizing(true);
      if (platform === 'youtube') {
        console.log('[LiveWindowsMode]', {
          selectedMode: 'youtube-oauth-then-ffmpeg-local',
          usesNgrok: false,
          usesMetro: false,
          usesRenderForAuth: true,
          usesRenderForStream: false,
        });
        console.log('[YouTube OAuth] opening browser auth');
      }
      await openPlatformOAuth(platform as LivestreamPlatform);
    } catch (_error) {
      setIsAuthorizing(false);
      Alert.alert('Lỗi', 'Không thể mở trình duyệt để đăng nhập nền tảng này.');
    }
  }, [isAplusProActive, platform, showLivestreamPaywall]);

  useEffect(() => {
    let mounted = true;

    const handleUrl = async ({url}: {url: string}) => {
      const callbackMatched = url?.toLowerCase().startsWith('aplusscore://oauth/callback');

      if (callbackMatched) {
        const shouldProcess = shouldProcessOAuthCallbackUrl(url);

        console.log('[YouTube OAuth] deep link received', {
          callbackMatched: true,
          containsSetupToken: /setupToken|setup_token|sessionToken|session_token|token/i.test(url || ''),
          duplicateSkipped: !shouldProcess,
        });

        if (!shouldProcess) {
          return;
        }
      }

      const payload = parseOAuthCallback(url);

      if (!payload || payload.platform !== platform) {
        return;
      }

      if (!mounted) {
        return;
      }

      setIsAuthorizing(false);

      if (payload.status !== 'success') {
        Alert.alert(
          'Đăng nhập thất bại',
          payload.errorMessage || 'Không thể kết nối tài khoản lúc này.',
        );
        return;
      }

      const nextAccountName = payload.accountName || `${platformName} Account`;
      const nextAccountId = payload.accountId || '';
      const nextSetupToken = payload.setupToken || setupToken;
      const successKey = [
        platform,
        nextAccountId,
        nextAccountName,
        nextSetupToken,
      ].join('|');

      if (latestOAuthSuccessKeyRef.current === successKey) {
        console.log('[YouTube OAuth] duplicate connected state skipped', {
          accountName: nextAccountName,
          accountId: nextAccountId,
          hasSetupToken: Boolean(nextSetupToken),
        });
        return;
      }

      latestOAuthSuccessKeyRef.current = successKey;

      if (platform === 'youtube') {
        console.log('[YouTube OAuth] connected state refresh start', {
          hasSetupToken: Boolean(nextSetupToken),
          accountName: nextAccountName,
          accountId: nextAccountId,
        });
      }

      setAccountName(nextAccountName);
      setAccountId(nextAccountId);
      setSetupToken(nextSetupToken);

      await persistLocalState(
        platform,
        nextAccountName,
        nextAccountId,
        visibility,
        nextSetupToken,
      );

      if (!mounted) {
        return;
      }

      if (platform === 'youtube') {
        console.log('[YouTube OAuth] connected state refresh success', {
          accountName: nextAccountName,
          accountId: nextAccountId,
          hasSetupToken: Boolean(nextSetupToken),
        });
      }

      if (shouldShowOAuthSuccessOnce(successKey)) {
        Alert.alert('Kết nối thành công', `Đã kết nối với ${platformName}.`);
      } else {
        console.log('[YouTube OAuth] duplicate success alert skipped', {
          accountName: nextAccountName,
          accountId: nextAccountId,
        });
      }
    };

    const subscription = Linking.addEventListener('url', handleUrl);

    Linking.getInitialURL().then(url => {
      if (url) {
        handleUrl({url});
      }
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [persistLocalState, platform, platformName, setupToken, visibility]);

  useEffect(() => {
    if (
      isLoading ||
      isAuthorizing ||
      (accountName && accountName.trim().length > 0) ||
      autoAuthTriggeredRef.current
    ) {
      return;
    }

    autoAuthTriggeredRef.current = true;

    if (!isAplusProActive) {
      showLivestreamPaywall();
      return;
    }

    startBrowserAuth();
  }, [accountName, isAplusProActive, isAuthorizing, isLoading, showLivestreamPaywall, startBrowserAuth]);

  const onLogout = useCallback(async () => {
    try {
      await persistLocalState(platform, '', '', visibility, '');
      setAccountName('');
      setAccountId('');
      setSetupToken('');
      autoAuthTriggeredRef.current = false;
      latestOAuthSuccessKeyRef.current = '';
      clearOAuthDedupeCache();
      Alert.alert('Đã đăng xuất', `Đã gỡ ${platformName} khỏi giao diện này.`);
    } catch (_error) {
      Alert.alert('Lỗi', 'Không thể đăng xuất lúc này.');
    }
  }, [persistLocalState, platform, platformName, visibility]);

  const onContinue = useCallback(async () => {
    if (!isAplusProActive) {
      showLivestreamPaywall();
      return;
    }

    if (!accountName || accountName.trim().length === 0) {
      Alert.alert(
        'Chưa đăng nhập',
        `Bạn cần đăng nhập ${platformName} trước khi tiếp tục.`,
      );
      autoAuthTriggeredRef.current = true;
      await startBrowserAuth();
      return;
    }

    try {
      await persistLocalState(platform, accountName, accountId, visibility, setupToken);

      props.navigate(screens.gameSettings, {
        livestreamPlatform: platform,
        saveToDeviceWhileStreaming,
        liveVisibility: visibility,
        liveAccountName: accountName,
        liveAccountId: accountId,
        liveSetupToken: setupToken,
      });
    } catch (_error) {
      Alert.alert('Lỗi', 'Không thể lưu thiết lập livestream.');
    }
  }, [
    accountId,
    accountName,
    isAplusProActive,
    persistLocalState,
    platform,
    platformName,
    props,
    saveToDeviceWhileStreaming,
    setupToken,
    showLivestreamPaywall,
    startBrowserAuth,
    visibility,
  ]);

  const renderRadio = useCallback(
    (selected: boolean) => {
      return (
        <View
          style={[
            styles.radioOuter,
            {
              width: ui.radioSize,
              height: ui.radioSize,
              borderRadius: ui.radioSize / 2,
            },
          ]}>
          {selected ? (
            <View
              style={[
                styles.radioInner,
                {
                  width: ui.radioSize * 0.5,
                  height: ui.radioSize * 0.5,
                  borderRadius: ui.radioSize * 0.25,
                },
              ]}
            />
          ) : null}
        </View>
      );
    },
    [ui.radioSize],
  );

  if (isLoading) {
    return (
      <Container style={styles.screen} isLoading={true}>
        <View />
      </Container>
    );
  }

  return (
    <Container style={styles.screen}>

      <View style={styles.headerGlow}>
        <Pressable
          onPress={onBack}
          style={styles.headerBackButton}
          android_ripple={{color: 'rgba(255,255,255,0.08)', borderless: false}}>
          <View style={styles.headerBackFrame}>
            <View style={styles.headerBackInner}>
  <AppImage
    source={require('../../assets/images/logo-back.png')}
    resizeMode="contain"
    style={{width: adaptive.s(18), height: adaptive.s(18), marginRight: adaptive.s(8)}}
  />
  <AppImage
    source={images.logoSmall || images.logo}
    resizeMode="contain"
    style={styles.headerBackLogoImage}
  />
</View>
          </View>
        </Pressable>

        <View pointerEvents="none" style={styles.headerTitleWrap}>
          <Text color={'#FFFFFF'} style={styles.headerTitle}>
            {headerTitle}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.contentInner}>
        <Text fontSize={ui.titleSize} color={'#FFFFFF'} style={styles.sectionLabel}>
          {accountSectionTitle}
        </Text>

        <Pressable onPress={startBrowserAuth} style={styles.accountRow}>
          {renderRadio(true)}

          <View style={styles.accountTextWrap}>
            <Text
              fontSize={ui.bodySize}
              fontWeight={'bold'}
              color={'#FFFFFF'}
              style={styles.primaryText}>
              {accountOptionTitle}
            </Text>

            <Text fontSize={ui.subSize} color={'#FFFFFF'} style={styles.mutedText}>
              Đang chọn:{' '}
              {accountName && accountName.trim().length > 0
                ? accountName
                : emptyAccountText}
            </Text>
          </View>
        </Pressable>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onLogout}
          style={[
            styles.logoutButton,
            {
              height: ui.buttonHeight,
              borderRadius: ui.boxRadius,
              marginTop: ui.sectionGap,
              borderWidth: ui.outlineWidth,
            },
          ]}>
          <Text
            fontSize={ui.buttonSize}
            fontWeight={'bold'}
            color={'#FFFFFF'}
            style={styles.logoutText}>
            ĐĂNG XUẤT
          </Text>
        </TouchableOpacity>

        <View style={{marginTop: ui.sectionGap * 1.5}}>
          <Text fontSize={ui.titleSize} color={'#FFFFFF'} style={styles.sectionLabel}>
            Quyền riêng tư
          </Text>

          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.optionRow, {marginTop: ui.optionGap}]}
            onPress={() => setVisibility('public')}>
            {renderRadio(visibility === 'public')}
            <Text fontSize={ui.bodySize} color={'#FFFFFF'} style={styles.optionLabel}>
              Công khai
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.optionRow, {marginTop: ui.optionGap}]}
            onPress={() => setVisibility('private')}>
            {renderRadio(visibility === 'private')}
            <Text fontSize={ui.bodySize} color={'#FFFFFF'} style={styles.optionLabel}>
              Riêng tư
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.optionRow, {marginTop: ui.optionGap}]}
            onPress={() => setVisibility('unlisted')}>
            {renderRadio(visibility === 'unlisted')}
            <Text fontSize={ui.bodySize} color={'#FFFFFF'} style={styles.optionLabel}>
              Không công khai
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onContinue}
          style={[
            styles.continueButton,
            {
              height: ui.buttonHeight,
              borderRadius: ui.boxRadius,
              marginTop: ui.sectionGap * 2,
            },
          ]}>
          <Text
            fontSize={ui.buttonSize}
            fontWeight={'bold'}
            style={styles.continueText}>
            {continueButtonText}
          </Text>
        </TouchableOpacity>
        </View>
      </ScrollView>
    </Container>
  );
};

export default memo(LivePlatformSetup);
