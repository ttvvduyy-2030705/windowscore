import {StyleSheet} from 'react-native';
import {scale as responsiveScale} from 'utils/responsive';
import {getSelectedFont} from 'configuration/fonts';

const borderColor = '#FFFFFF';
const headerGrey = '#676767';
const runGrey = '#CCCCCC';
const heavyFont = getSelectedFont('Nunito-Regular', 'black');

const whiteBoldText = {
  color: '#FFFFFF',
  fontFamily: heavyFont,
  fontWeight: '900' as const,
  includeFontPadding: false,
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    minWidth: responsiveScale(280),
    borderRadius: responsiveScale(18),
    overflow: 'hidden',
    backgroundColor: '#000000',
    borderWidth: responsiveScale(3),
    borderColor,
  },

  containerCompact: {
    borderRadius: responsiveScale(12),
  },

  boardContent: {
    position: 'relative',
    width: '100%',
    backgroundColor: '#000000',
  },

  headerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: headerGrey,
  },

  headerTitleCell: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: responsiveScale(12),
    paddingRight: responsiveScale(12),
    backgroundColor: headerGrey,
  },

  headerTitleMarqueeViewport: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    justifyContent: 'center',
  },

  headerTitleMarqueeInner: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexShrink: 0,
  },

  headerTitleMarqueeSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    minWidth: 0,
    justifyContent: 'flex-start',
    overflow: 'visible',
  },

  headerTitleMeasureText: {
    position: 'absolute',
    left: -10000,
    top: -10000,
    opacity: 0,
    zIndex: -1,
    elevation: -1,
    flexShrink: 0,
  },

  headerTitleMarqueeText: {
    flexShrink: 0,
    ...whiteBoldText,
    fontSize: responsiveScale(20),
    lineHeight: responsiveScale(26),
    textTransform: 'uppercase',
    includeFontPadding: true,
  },

  headerTitleMarqueeTextCompact: {
    fontSize: responsiveScale(15),
    lineHeight: responsiveScale(20),
    includeFontPadding: true,
  },

  headerTitleText: {
    flex: 1,
    minWidth: 0,
    ...whiteBoldText,
    fontSize: responsiveScale(23),
    lineHeight: responsiveScale(27),
    textTransform: 'uppercase',
  },

  headerTitleTextCompact: {
    fontSize: responsiveScale(17),
    lineHeight: responsiveScale(21),
  },

  headerGoalText: {
    marginLeft: responsiveScale(8),
    ...whiteBoldText,
    fontSize: responsiveScale(21),
    lineHeight: responsiveScale(25),
  },

  headerGoalTextCompact: {
    fontSize: responsiveScale(15),
    lineHeight: responsiveScale(19),
  },

  headerTurnGroupCell: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: headerGrey,
  },

  headerInnText: {
    ...whiteBoldText,
    fontSize: responsiveScale(21),
    lineHeight: responsiveScale(25),
    textAlign: 'center',
  },

  headerInnTextCompact: {
    fontSize: responsiveScale(15),
    lineHeight: responsiveScale(19),
  },

  playersTable: {
    backgroundColor: '#000000',
  },

  playerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#000000',
  },

  playerNameCell: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: responsiveScale(11),
    paddingRight: responsiveScale(10),
    backgroundColor: '#000000',
  },

  playerNameText: {
    flex: 1,
    minWidth: 0,
    ...whiteBoldText,
    fontSize: responsiveScale(34),
    lineHeight: responsiveScale(38),
    textTransform: 'uppercase',
  },

  playerNameTextCompact: {
    fontSize: responsiveScale(25),
    lineHeight: responsiveScale(29),
  },

  flagBadge: {
    width: responsiveScale(54),
    height: responsiveScale(36),
    borderRadius: responsiveScale(8),
    overflow: 'hidden',
    backgroundColor: '#EA2B2B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: responsiveScale(12),
  },

  flagBadgeCompact: {
    width: responsiveScale(38),
    height: responsiveScale(26),
    borderRadius: responsiveScale(6),
    marginRight: responsiveScale(8),
  },

  flagImage: {
    width: '100%',
    height: '100%',
  },

  flagText: {
    ...whiteBoldText,
    fontSize: responsiveScale(14),
    lineHeight: responsiveScale(17),
    textAlign: 'center',
  },

  scoreCell: {
    minWidth: 0,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  scoreText: {
    ...whiteBoldText,
    textAlign: 'center',
  },

  runCell: {
    minWidth: 0,
    backgroundColor: runGrey,
    alignItems: 'center',
    justifyContent: 'center',
  },

  currentRunBadge: {
    width: responsiveScale(50),
    height: responsiveScale(50),
    borderRadius: responsiveScale(25),
    backgroundColor: '#EEF4F7',
    borderWidth: responsiveScale(1.2),
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  currentRunBadgeCompact: {
    width: responsiveScale(36),
    height: responsiveScale(36),
    borderRadius: responsiveScale(18),
  },

  currentRunText: {
    color: '#111111',
    fontFamily: heavyFont,
    fontWeight: '900',
    fontSize: responsiveScale(28),
    lineHeight: responsiveScale(32),
    includeFontPadding: false,
    textAlign: 'center',
  },

  currentRunTextCompact: {
    fontSize: responsiveScale(20),
    lineHeight: responsiveScale(24),
  },

  countdownRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    paddingLeft: responsiveScale(10),
    paddingRight: responsiveScale(8),
  },

  countdownTrack: {
    flex: 1,
    height: responsiveScale(32),
    backgroundColor: '#111111',
    borderRadius: responsiveScale(16),
    overflow: 'hidden',
    borderWidth: responsiveScale(1.2),
    borderColor: 'rgba(255,255,255,0.10)',
  },

  countdownFillClip: {
    height: '100%',
    overflow: 'hidden',
    borderRadius: responsiveScale(16),
  },

  countdownFill: {
    width: '100%',
    height: '100%',
    borderRadius: responsiveScale(16),
  },

  countdownTextCell: {
    width: responsiveScale(62),
    minWidth: responsiveScale(62),
    paddingLeft: responsiveScale(8),
    alignItems: 'center',
    justifyContent: 'center',
  },

  countdownText: {
    ...whiteBoldText,
    fontSize: responsiveScale(34),
    lineHeight: responsiveScale(38),
    textAlign: 'center',
  },

  countdownTextCompact: {
    fontSize: responsiveScale(24),
    lineHeight: responsiveScale(28),
  },

  absoluteLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: borderColor,
    zIndex: 100,
    elevation: 100,
  },

  absoluteLineVertical: {
    position: 'absolute',
    backgroundColor: borderColor,
    zIndex: 101,
    elevation: 101,
  },
});

export default styles;
