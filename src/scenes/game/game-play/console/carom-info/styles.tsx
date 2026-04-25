import colors from 'configuration/colors';
import {StyleSheet} from 'react-native';
import {scale as responsiveScale} from 'utils/responsive';

const RADIUS = responsiveScale(18);

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderRightWidth: responsiveScale(20),
    borderColor: '#757670',
    backgroundColor: '#757670',
    borderRadius: RADIUS,
    overflow: 'hidden',
  },

  totalTurnWrapper: {
    backgroundColor: '#757670',
    marginRight: responsiveScale(4),
  },

  totalTurnWrapperCompact: {
    marginRight: responsiveScale(2),
  },


  containerCompact: {
    borderRightWidth: responsiveScale(10),
    borderRadius: responsiveScale(12),
  },

  flagBadge: {
    width: responsiveScale(34),
    height: responsiveScale(22),
    borderRadius: responsiveScale(4),
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: responsiveScale(8),
    overflow: 'hidden',
  },

  flagBadgeCompact: {
    width: responsiveScale(24),
    height: responsiveScale(16),
    marginRight: responsiveScale(4),
  },

  flagText: {
    fontSize: responsiveScale(11),
    lineHeight: responsiveScale(13),
    textAlign: 'center',
    includeFontPadding: false,
  },

  nameWithFlag: {
    marginRight: responsiveScale(6),
  },

  nameWithFlagCompact: {
    marginRight: responsiveScale(3),
  },

  turnImage: {    width: responsiveScale(40),
    height: responsiveScale(40),
    tintColor: colors.red,
    marginLeft: responsiveScale(10),
    marginRight: responsiveScale(-5),
  },

  turnImageCompact: {
    width: responsiveScale(26),
    height: responsiveScale(26),
    marginLeft: responsiveScale(4),
    marginRight: responsiveScale(-2),
  },

  empty: {
    width: responsiveScale(40),
    height: responsiveScale(40),
    marginLeft: responsiveScale(10),
  },

  emptyCompact: {
    width: responsiveScale(26),
    height: responsiveScale(26),
    marginLeft: responsiveScale(4),
  },

  countdownContainer: {
    backgroundColor: '#757670',
  },

  linearWrapper: {
    flex: 1,
    height: 40,
    overflow: 'hidden',
    marginHorizontal: responsiveScale(15),
  },

  linear: {
    position: 'absolute',
    backgroundColor: colors.white,
    height: 40,
    width: '100%',
  },

  countdownWrapper: {
    height: '100%',
  },

  countdownWrapperCompact: {
    minWidth: responsiveScale(30),
  },

  currentTotalPoint: {
    marginBottom: responsiveScale(3),
    minWidth: responsiveScale(44),
    alignItems: 'center',
  },

  totalPointWrapper: {
    backgroundColor: colors.black,
    minWidth: responsiveScale(74),
    alignItems: 'center',
  },

  totalPointWrapperCompact: {
    minWidth: responsiveScale(54),
  },

  totalPointText0: {
    marginBottom: responsiveScale(-11),
  },

  totalPointText1: {
    marginTop: responsiveScale(4),
    marginBottom: responsiveScale(-11),
  },

  currentTotalPointCompact: {
    minWidth: responsiveScale(32),
  },

  currentPointText: {
    marginBottom: responsiveScale(-11),
  },

  buttonTurns: {
    borderColor: colors.black,
    borderWidth: 0.5,
    backgroundColor: colors.yellow,
  },
});

export default styles;