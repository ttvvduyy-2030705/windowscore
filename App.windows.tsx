import 'react-native-get-random-values';

import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, View as RNView} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {Provider} from 'react-redux';
import {PersistGate} from 'redux-persist/integration/react';
import {NavigationContainer} from '@react-navigation/native';
import DeviceInfo from 'react-native-device-info';


import {StackScreens} from 'scenes';
import {LanguageContext} from 'context/language';
import {PreviewVideoProvider} from 'context/bluetooth';
import {loadLanguage, setLanguage} from 'i18n';
import {navigationRef} from 'utils/navigation';
import Loading from 'components/Loading';

import storage, {persistor} from 'data/redux';
import {WindowsRealmProvider} from './src/platform/windows/realm-react';
import {LIVESTREAM_AUTH_BASE_URL} from 'config/livestreamAuth';

let hasLoggedWindowsBuildInfo = false;

const logWindowsBuildInfoOnce = () => {
  if (hasLoggedWindowsBuildInfo) {
    return;
  }

  hasLoggedWindowsBuildInfo = true;

  // Build info is diagnostic information only. Keep it on console.log so React Native
  // does not show fake warning component stacks during startup.
  console.log('[Build Info] app started');
  console.log('[Build Info] live-fix-build=20260504-black-logo-loading-screen');
  console.log(`[Build Info] apiBaseUrl=${LIVESTREAM_AUTH_BASE_URL}`);
  console.log(`[Build Info] package=${DeviceInfo.getBundleId()}`);
  console.log(`[Build Info] versionName=${DeviceInfo.getVersion()}`);
  console.log(`[Build Info] versionCode=${DeviceInfo.getBuildNumber()}`);
};

const AppWindows = (): React.JSX.Element => {
  const [isLoading, setIsLoading] = useState(true);
  const [currentLanguage, setCurrentLanguage] = useState('vi');

  const initApp = useCallback(async () => {
    try {
      logWindowsBuildInfoOnce();
      const language = await loadLanguage();
      setCurrentLanguage(language);
    } catch (error: any) {
      console.log('[Windows] load language skipped:', error?.message || error);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        await initApp();
      } catch (error: any) {
        console.log('[Windows] App init error:', error?.message || error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [initApp]);

  const onChangeCurrentLanguage = useCallback((language: string) => {
    setCurrentLanguage(language);
    void setLanguage(language);
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      <WindowsRealmProvider>
        <Provider store={storage}>
          <PersistGate loading={null} persistor={persistor}>
            <NavigationContainer ref={navigationRef}>
              <LanguageContext.Provider
                value={{
                  language: currentLanguage,
                  onChangeCurrentLanguage,
                }}>
                <PreviewVideoProvider>
                  {isLoading ? (
                    <RNView style={styles.bootLoadingScreen}>
                      <Loading isLoading />
                    </RNView>
                  ) : (
                    <StackScreens />
                  )}
                </PreviewVideoProvider>
              </LanguageContext.Provider>
            </NavigationContainer>
          </PersistGate>
        </Provider>
      </WindowsRealmProvider>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bootLoadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
});

export default AppWindows;