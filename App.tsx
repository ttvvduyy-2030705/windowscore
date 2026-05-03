import 'react-native-get-random-values';
import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {RealmProvider} from '@realm/react';
import {Provider} from 'react-redux';
import {PersistGate} from 'redux-persist/integration/react';
import {NavigationContainer} from '@react-navigation/native';
import DeviceInfo from 'react-native-device-info';
import {GoogleSignin} from '@react-native-google-signin/google-signin';

import {StackScreens} from 'scenes';
import {LanguageContext} from 'context/language';
import {loadLanguage, setLanguage} from 'i18n';
import {navigationRef} from 'utils/navigation';
import Container from 'components/Container';
import View from 'components/View';
import Loading from 'components/Loading';
import storage, {persistor} from 'data/redux';
import {GameSchema, GameSettingsModeSchema} from 'data/realm/models/game';
import {PoolBallSchema} from 'data/realm/models/ball';
import {
  PlayerSchema,
  PlayerProModeSchema,
  PlayerSettingsSchema,
  PlayerGoalSchema,
} from 'data/realm/models/player';
import RemoteControl from 'utils/remote';


const installReleaseLogFilter = () => {
  if (__DEV__) {
    return;
  }

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);

  const noisyPrefixes = [
    '[Replay]',
    '[Live]',
    '[Remote]',
    '[UVC]',
    '[Video]',
    '[Extension]',
    '[YouTube Live]',
    '[YouTubeNativeLive]',
    'Starting recording...',
    'Stopping recording...',
    'Recording finished:',
    'Free disk storae',
  ];

  const shouldDrop = (firstArg: unknown) => {
    if (typeof firstArg !== 'string') {
      return false;
    }

    return noisyPrefixes.some(prefix => firstArg.startsWith(prefix));
  };

  console.log = (...args: any[]) => {
    if (shouldDrop(args[0])) {
      return;
    }
    originalLog(...args);
  };

  console.warn = (...args: any[]) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('NativeEventEmitter')
    ) {
      return;
    }
    originalWarn(...args);
  };
};

GoogleSignin.configure({
  scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
  webClientId:
    '378804694906-259gm8ni9ub5q27jb9796l16djd8clva.apps.googleusercontent.com',
});

const App = (): React.JSX.Element => {
  const [isLoading, setIsLoading] = useState(true);
  const [currentLanguage, setCurrentLanguage] = useState('vi');

  const initApp = useCallback(async () => {
    installReleaseLogFilter();
    await DeviceInfo.getInstanceId();
    const language = await loadLanguage();
    setCurrentLanguage(language);
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        await initApp();
      } catch (error: any) {
        console.log('App init error:', error?.message || error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
      try {
        RemoteControl.instance.removeAllListeners();
      } catch (error: any) {
        console.log('Remote cleanup skipped:', error?.message || error);
      }
    };
  }, [initApp]);

  const onChangeCurrentLanguage = useCallback((language: string) => {
    setCurrentLanguage(language);
    void setLanguage(language);
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      <RealmProvider
        deleteRealmIfMigrationNeeded
        schema={[
          GameSchema,
          GameSettingsModeSchema,
          PlayerSettingsSchema,
          PlayerSchema,
          PlayerProModeSchema,
          PlayerGoalSchema,
          PoolBallSchema,
        ]}>
        <Provider store={storage}>
          <PersistGate loading={null} persistor={persistor}>
            <NavigationContainer ref={navigationRef}>
              <LanguageContext.Provider
                value={{
                  language: currentLanguage,
                  onChangeCurrentLanguage,
                }}>
                {isLoading ? (
                  <Container style={styles.bootLoadingScreen}>
                    <View flex={'1'} alignItems={'center'} justify={'center'}>
                      <Loading isLoading />
                    </View>
                  </Container>
                ) : (
                  <StackScreens />
                )}
              </LanguageContext.Provider>
            </NavigationContainer>
          </PersistGate>
        </Provider>
      </RealmProvider>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bootLoadingScreen: {
    backgroundColor: '#000000',
  },
});

export default App;