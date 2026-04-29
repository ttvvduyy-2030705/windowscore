import {Dimensions} from 'react-native';

const getWindow = () => {
  const {width, height} = Dimensions.get('window');
  return {
    width: width > 0 ? width : 1,
    height: height > 0 ? height : 1,
  };
};

const dims = {
  get screenWidth() {
    return getWindow().width;
  },
  get screenHeight() {
    return getWindow().height;
  },
};

const getStatusBarHeight = () => 0;
const getHeaderHeight = () => 0;
const getBottomSpace = () => 0;

export {dims, getStatusBarHeight, getHeaderHeight, getBottomSpace};
