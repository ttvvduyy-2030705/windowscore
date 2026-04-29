import {useWindowDimensions} from 'react-native';

export type EdgeInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const ZERO_INSETS: EdgeInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export const getEstimatedSafeAreaInsets = (
  _width: number,
  _height: number,
): EdgeInsets => ZERO_INSETS;

export const useSafeScreenInsets = (): EdgeInsets => {
  useWindowDimensions();
  return ZERO_INSETS;
};

export default useSafeScreenInsets;
