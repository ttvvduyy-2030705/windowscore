import 'react-native-get-random-values';

import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {Provider} from 'react-redux';
import {PersistGate} from 'redux-persist/integration/react';
import {NavigationContainer} from '@react-navigation/native';

import {StackScreens} from 'scenes';
import {LanguageContext} from 'context/language';
import {loadLanguage, setLanguage} from 'i18n';
import {navigationRef} from 'utils/navigation';
import Loading from 'components/Loading';

import storage, {persistor} from 'data/redux';
import {WindowsRealmProvider} from './src/platform/windows/realm-react';

const AppWindows = (): React.JSX.Element => {
  const [isLoading, setIsLoading] = useState(true);
  const [currentLanguage, setCurrentLanguage] = useState('vi');

  const initApp = useCallback(async () => {
    try {
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
                {isLoading ? <Loading /> : <StackScreens />}
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
});

export default AppWindows;