import {StyleSheet} from 'react-native';
import {responsiveDimension} from 'utils/helper';

const styles = StyleSheet.create({
  loading: {
    alignSelf: 'center',
    width: responsiveDimension(320),
    height: responsiveDimension(138),
  },
  loading_small: {
    alignSelf: 'center',
    width: responsiveDimension(150),
    height: responsiveDimension(64),
  },
  loading_large: {
    alignSelf: 'center',
    width: responsiveDimension(440),
    height: responsiveDimension(188),
  },
});

export default styles;
