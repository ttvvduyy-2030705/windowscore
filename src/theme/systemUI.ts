import {useFocusEffect} from '@react-navigation/native';
import {useCallback, useEffect} from 'react';
import {StatusBar, StatusBarStyle} from 'react-native';

export type ScreenSystemUIVariant = 'fullscreen';

type ConfigureSystemUIOptions = {
  variant?: ScreenSystemUIVariant;
  barStyle?: StatusBarStyle;
  backgroundColor?: string;
  animated?: boolean;
};

export const configureSystemUI = ({
  barStyle = 'light-content',
  animated = true,
}: ConfigureSystemUIOptions = {}) => {
  StatusBar.setHidden(true, animated ? 'fade' : 'none');
  StatusBar.setBarStyle(barStyle, animated);
};

export const useGlobalFullscreenSystemUI = (
  options: ConfigureSystemUIOptions = {},
) => {
  useEffect(() => {
    configureSystemUI(options);
  }, [options.animated, options.backgroundColor, options.barStyle]);
};

export const useScreenSystemUI = ({
  barStyle = 'light-content',
  backgroundColor = 'transparent',
  animated = true,
}: ConfigureSystemUIOptions = {}) => {
  useFocusEffect(
    useCallback(() => {
      configureSystemUI({barStyle, backgroundColor, animated});

      return () => {
        configureSystemUI({barStyle, backgroundColor, animated});
      };
    }, [animated, backgroundColor, barStyle]),
  );
};

export default useScreenSystemUI;
