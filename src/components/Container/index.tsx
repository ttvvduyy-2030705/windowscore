import React, {memo, useMemo, ReactNode} from 'react';
import {View as RNView, ViewStyle} from 'react-native';

import colors from 'configuration/colors';
import useSafeScreenInsets from 'theme/safeArea';

import Loading from '../Loading';

import styles from './styles';

type ContainerVariant = 'fullscreen';

interface ContainerProps {
  children: ReactNode;
  isLoading?: boolean;
  loadingBackgroundColor?: string;
  style?: ViewStyle | ViewStyle[];
  safeAreaDisabled?: boolean;
  safeAreaEdges?: Array<'bottom' | 'left' | 'right'>;
  variant?: ContainerVariant;
}

const DEFAULT_SAFE_AREA_EDGES: Array<'bottom' | 'left' | 'right'> = [
  'bottom',
  'left',
  'right',
];

const Container = (props: ContainerProps) => {
  const {
    children,
    isLoading,
    loadingBackgroundColor = colors.black,
    style,
    safeAreaDisabled,
    safeAreaEdges = DEFAULT_SAFE_AREA_EDGES,
    variant = 'fullscreen',
  } = props;

  const insets = useSafeScreenInsets();

  const loadingStyle = useMemo(() => {
    return [styles.loadingWrapper, {backgroundColor: loadingBackgroundColor}];
  }, [loadingBackgroundColor]);

  const safePaddingStyle = useMemo(() => {
    if (safeAreaDisabled) {
      return styles.noSafeArea;
    }

    return {
      paddingTop: 0,
      paddingBottom: safeAreaEdges.includes('bottom') ? insets.bottom : 0,
      paddingLeft: safeAreaEdges.includes('left') ? insets.left : 0,
      paddingRight: safeAreaEdges.includes('right') ? insets.right : 0,
    };
  }, [
    insets.bottom,
    insets.left,
    insets.right,
    safeAreaDisabled,
    safeAreaEdges,
  ]);

  const _style = useMemo(() => {
    return [styles.container, safePaddingStyle, style];
  }, [safePaddingStyle, style]);

  return (
    <RNView style={_style}>
      {children}
      {isLoading && (
        <RNView style={loadingStyle}>
          <Loading isLoading={true} />
        </RNView>
      )}
    </RNView>
  );
};

export default memo(Container);
