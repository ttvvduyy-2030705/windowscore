import React, {memo, FunctionComponent, useCallback, useState} from 'react';
import {InteractionManager, StyleSheet} from 'react-native';
import View from 'components/View';
import Container from 'components/Container';
import ErrorBoundary from 'components/ErrorBoundary';
import Text from 'components/Text';
import Image from 'components/Image';
import {useFocusEffect} from '@react-navigation/native';
import i18n from 'i18n';
import images from 'assets';

import {LanguageContext} from 'context/language';
import useScreenSystemUI from 'theme/systemUI';

import configColors from 'configuration/colors';

const heavyScreens: string[] = [];

const noNetworkScreens = ['home'];

const withWrapper = (SceneName: string, Scene: FunctionComponent) => {
  const defaultIsReady = heavyScreens.includes(SceneName) ? false : true;

  const WrappedScene = (props: any): React.JSX.Element => {
    const {navigation, route, isNetworkConnected} = props;

    useScreenSystemUI({variant: 'fullscreen', barStyle: 'light-content'});

    const [isReady, setIsReady] = useState(defaultIsReady);

    //Prioritize navigation until the component of the screen is ready to view
    useFocusEffect(
      useCallback(() => {
        if (isReady) {
          return () => {};
        }

        const task = InteractionManager.runAfterInteractions(() => {
          const timeout = setTimeout(() => {
            setIsReady(true);
            clearTimeout(timeout);
          }, 0);
        });

        return () => task.cancel();
      }, [isReady]),
    );

    const navigate = useCallback(
      (name: string, params: Object) => {
        navigation.navigate(name, params);
      },
      [navigation],
    );

    const goBack = useCallback(() => {
      navigation.goBack();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const reset = useCallback((index: number, routes: Array<any>) => {
      navigation.reset(index, routes);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const replace = useCallback(
      ({name, params}: {name: string; params: Object}) => {
        navigation.replace(name, params);
      },
      [navigation],
    );

    const setParams = useCallback((params: Object) => {
      navigation.setParams(params);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const setOptions = useCallback((options: {[key: string]: any}) => {
      navigation.setOptions(options);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isFocused = useCallback(() => {
      return navigation.isFocused();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addListener = useCallback((name: string, callback: Function) => {
      //remember to unsubscribe
      return navigation.addListener(name, callback);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const popToTop = useCallback(() => {
      navigation.popToTop();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const translate = useCallback((text: string, args?: object) => {
      return i18n.t(text, args);
    }, []);

    const getLocale = useCallback(() => {
      return i18n.locale;
    }, []);

    const renderScene = useCallback(
      () => (
        <Scene
          navigate={navigate}
          goBack={goBack}
          reset={reset}
          setParams={setParams}
          setOptions={setOptions}
          isFocused={isFocused}
          addListener={addListener}
          popToTop={popToTop}
          replace={replace}
          translate={translate}
          getLocale={getLocale}
          {...route.params} //destructuring props from route
        />
      ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    if (!isReady) {
      return (
        <Container isLoading={true} loadingBackgroundColor={configColors.black}>
          <View />
        </Container>
      );
    }

    if (!isNetworkConnected && noNetworkScreens.includes(SceneName)) {
      return (
        <View flex={'1'} alignItems={'center'} justify={'center'}>
          <Image
            source={images.offline}
            style={styles.image}
            resizeMode={'contain'}
          />
          <Text>{i18n.t('msgNetworkError')}</Text>
        </View>
      );
    }

    return <ErrorBoundary goBack={goBack}>{renderScene()}</ErrorBoundary>;
  };

  return memo(props => (
    <LanguageContext.Consumer>
      {({language}: {language: string}) => (
        <WrappedScene
          {...props}
          isNetworkConnected={true}
          currentLanguage={language}
        />
      )}
    </LanguageContext.Consumer>
  ));
};

const styles = StyleSheet.create({
  image: {
    width: 150,
    height: 150,
  },
});

export {withWrapper};
