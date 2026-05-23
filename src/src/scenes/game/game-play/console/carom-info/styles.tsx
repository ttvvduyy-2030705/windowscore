import {StyleSheet} from 'react-native';
import {scale as responsiveScale} from 'utils/responsive';

const radius = responsiveScale(18);
const borderColor = '#D9D9D9';
const greyTop = '#9A9A9A';
const greyBottom = '#565656';

const styles = StyleSheet.create({
  container: {
    width: '100%',
    minWidth: responsiveScale(420),
    borderRadius: radius,
    overflow: 'hidden',
    backgroundColor: '#000000',
    borderWidth: responsiveScale(1.5),
    borderColor,
  },

  containerCompact: {
    minWidth: responsiveScale(330),
    borderRadius: responsiveScale(12),
  },

  headerRow: {
    minHeight: responsiveScale(46),
    backgroundColor: greyBottom,
    borderBottomWidth: responsiveScale(2),
    borderBottomColor: borderColor,
  },

  headerTitleCell: {
    flex: 1,
    minWidth: 0,
    paddingLeft: responsiveScale(12),
    paddingRight: responsiveScale(10),
    backgroundColor: greyBottom,
  },

  headerTitleText: {
    flex: 1,
    minWidth: 0,
    fontSize: responsiveScale(25),
    lineHeight: responsiveScale(31),
    letterSpacing: responsiveScale(0.6),
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: {width: 0, height: responsiveScale(1)},
    textShadowRadius: responsiveScale(2),
  },

  headerTitleTextCompact: {
    fontSize: responsiveScale(19),
    lineHeight: responsiveScale(24),
  },

  headerGoalText: {
    marginLeft: responsiveScale(8),
    fontSize: responsiveScale(24),
    lineHeight: responsiveScale(30),
    letterSpacing: responsiveScale(0.5),
  },

  headerGoalTextCompact: {
    fontSize: responsiveScale(18),
    lineHeight: responsiveScale(23),
  },

  headerInnCell: {
    width: responsiveScale(114),
    borderLeftWidth: responsiveScale(2),
    borderLeftColor: borderColor,
    paddingHorizontal: responsiveScale(8),
    backgroundColor: greyBottom,
  },

  headerInnText: {
    fontSize: responsiveScale(24),
    lineHeight: responsiveScale(30),
    letterSpacing: responsiveScale(0.4),
  },

  headerInnTextCompact: {
    fontSize: responsiveScale(18),
    lineHeight: responsiveScale(23),
  },

  playersTable: {
    backgroundColor: '#000000',
  },

  playerRow: {
    minHeight: responsiveScale(72),
    backgroundColor: '#000000',
    borderBottomWidth: responsiveScale(2),
    borderBottomColor: borderColor,
  },

  playerRowCompact: {
    minHeight: responsiveScale(54),
  },

  playerNameCell: {
    flex: 1,
    minWidth: 0,
    paddingLeft: responsiveScale(11),
    paddingRight: responsiveScale(10),
    backgroundColor: '#000000',
  },

  playerNameText: {
    flex: 1,
    minWidth: 0,
    fontSize: responsiveScale(36),
    lineHeight: responsiveScale(43),
    letterSpacing: responsiveScale(0.6),
  },

  playerNameTextCompact: {
    fontSize: responsiveScale(25),
    lineHeight: responsiveScale(31),
  },

  flagBadge: {
    width: responsiveScale(54),
    height: responsiveScale(38),
    borderRadius: responsiveScale(9),
    overflow: 'hidden',
    backgroundColor: '#E93636',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: responsiveScale(13),
  },

  flagBadgeCompact: {
    width: responsiveScale(38),
    height: responsiveScale(27),
    borderRadius: responsiveScale(6),
    marginRight: responsiveScale(8),
  },

  flagImage: {
    width: '100%',
    height: '100%',
  },

  flagText: {
    fontSize: responsiveScale(15),
    lineHeight: responsiveScale(18),
    includeFontPadding: false,
  },

  scoreCell: {
    width: responsiveScale(86),
    backgroundColor: '#000000',
    borderLeftWidth: responsiveScale(2),
    borderLeftColor: borderColor,
    borderRightWidth: responsiveScale(2),
    borderRightColor: borderColor,
  },

  scoreText: {
    includeFontPadding: false,
  },

  runCell: {
    width: responsiveScale(76),
    backgroundColor: greyTop,
  },

  runCellCompact: {
    width: responsiveScale(56),
  },

  currentRunBadge: {
    width: responsiveScale(56),
    height: responsiveScale(56),
    borderRadius: responsiveScale(28),
    backgroundColor: '#F3FBFF',
    borderWidth: responsiveScale(1),
    borderColor: 'rgba(255,255,255,0.8)',
  },

  currentRunBadgeCompact: {
    width: responsiveScale(40),
    height: responsiveScale(40),
    borderRadius: responsiveScale(20),
  },

  currentRunText: {
    fontSize: responsiveScale(32),
    lineHeight: responsiveScale(38),
    includeFontPadding: false,
  },

  currentRunTextCompact: {
    fontSize: responsiveScale(22),
    lineHeight: responsiveScale(27),
  },

  countdownRow: {
    minHeight: responsiveScale(52),
    backgroundColor: '#000000',
    paddingLeft: responsiveScale(10),
    paddingRight: responsiveScale(8),
  },

  countdownTrack: {
    flex: 1,
    height: responsiveScale(34),
    backgroundColor: '#111111',
    borderRadius: responsiveScale(17),
    overflow: 'hidden',
    borderWidth: responsiveScale(1.2),
    borderColor: 'rgba(255,255,255,0.15)',
  },

  countdownFillClip: {
    height: '100%',
    overflow: 'hidden',
    borderRadius: responsiveScale(17),
  },

  countdownFill: {
    width: '100%',
    height: '100%',
    borderRadius: responsiveScale(17),
  },

  countdownTextCell: {
    width: responsiveScale(62),
    paddingLeft: responsiveScale(8),
  },

  countdownText: {
    fontSize: responsiveScale(36),
    lineHeight: responsiveScale(42),
    includeFontPadding: false,
  },

  countdownTextCompact: {
    fontSize: responsiveScale(25),
    lineHeight: responsiveScale(30),
  },
});

export default styles;
