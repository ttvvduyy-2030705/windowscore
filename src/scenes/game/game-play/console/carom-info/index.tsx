import React, {memo, useCallback} from 'react';
import {getFlagImageSource, getFlagText, normalizePlayerCountry} from 'platform/windows/flags';
import {Image as RNImage, TextStyle} from 'react-native';
import View from 'components/View';
import Text from 'components/Text';
import Image from 'components/Image';
import Countdown from 'components/Countdown';
import colors from 'configuration/colors';
import {Player} from 'types/player';

import useAdaptiveLayout from 'scenes/game/useAdaptiveLayout';
import images from 'assets';
import CaromInfoViewModel, {Props} from './CaromInfoViewModel';
import styles from './styles';
import {getCountryFlagImageUri} from '../../../settings/player/countries';


const getPlayerFlagImageSource = (player?: {countryCode?: string; flag?: string}) =>
  getFlagImageSource(normalizePlayerCountry(player as any));

const getPlayerFlagText = (player?: {flag?: string}) =>
  getFlagText(normalizePlayerCountry(player as any));

const CaromInfo = (props: Props) => {
  const viewModel = CaromInfoViewModel(props);
  const adaptive = useAdaptiveLayout();
  const isLibre = props.gameSettings?.category === 'libre';
  const countdownBarWidth = adaptive.width * (props.compact ? 0.16 : 0.225);
  // Keep the green countdown bar fixed and move only the timer text
  // closer to the bar. This avoids stretching or shifting the bar itself
  // in camera/fullscreen/replay overlays.
  const caromTimerTextOffset = adaptive.s(props.compact ? 36 : 48);

  const getTotalPointFont = useCallback(
    (point: number) => {
      const value = Number(point || 0);
      const baseLarge = props.compact ? 30 : 40;
      const baseLargeLine = props.compact ? 34 : 46;
      const baseMedium = props.compact ? 24 : 30;
      const baseMediumLine = props.compact ? 28 : 34;
      const baseSmall = props.compact ? 18 : 22;
      const baseSmallLine = props.compact ? 22 : 26;

      if (!isLibre) {
        return {
          fontSize: baseLarge,
          lineHeight: baseLargeLine,
        };
      }

      if (value >= 1000) {
        return {
          fontSize: baseSmall,
          lineHeight: baseSmallLine,
        };
      }

      if (value >= 100) {
        return {
          fontSize: baseMedium,
          lineHeight: baseMediumLine,
        };
      }

      return {
        fontSize: baseLarge,
        lineHeight: baseLargeLine,
      };
    },
    [isLibre, props.compact],
  );

  const renderPlayer = useCallback(
    (player: Player, index: number, totalPointStyle: TextStyle) => {
      const totalPointValue = Number(player.totalPoint || 0);
      const totalPointFont = getTotalPointFont(totalPointValue);

      const playerFlag = getPlayerFlagText(player as any);
      const playerFlagImage = getPlayerFlagImageSource(player as any);

      return (
        <View
  style={{
    backgroundColor: player.color,
    borderTopLeftRadius: index === 0 ? 10 : 0,
    borderTopRightRadius: index === 0 ? 10 : 0,
    borderBottomLeftRadius: index === 1 ? 10 : 0,
    borderBottomRightRadius: index === 1 ? 10 : 0,
    overflow: 'hidden',
  }}
  direction={'row'}
  alignItems={'center'}>
          <View direction={'row'} alignItems={'center'} paddingLeft={'10'}>
            {playerFlagImage || playerFlag ? (
              <View style={[styles.flagBadge, props.compact ? styles.flagBadgeCompact : undefined]}>
                {playerFlagImage ? (
                  <RNImage
                    source={playerFlagImage}
                    resizeMode="contain"
                    fadeDuration={0}
                    style={{width: '100%', height: '100%', backgroundColor: '#FFFFFF'}}
                  />
                ) : (
                  <Text style={styles.flagText}>{playerFlag}</Text>
                )}
              </View>
            ) : null}

            <View
              flex={'1'}
              style={[(playerFlagImage || playerFlag) ? styles.nameWithFlag : undefined, props.compact ? styles.nameWithFlagCompact : undefined]}>
              <Text
                fontSize={props.compact ? 16 : 22}
                lineHeight={props.compact ? 20 : 26}
                fontWeight={'900'}
                numberOfLines={1}>
                {player.name.toUpperCase()}
              </Text>
            </View>

            {props.currentPlayerIndex === index ? (
              <Image
                source={images.game.turn}
                style={[styles.turnImage, props.compact ? styles.turnImageCompact : undefined]}
              />
            ) : (
              <View style={[styles.empty, props.compact ? styles.emptyCompact : undefined]} />
            )}

            <View direction={'row'} alignItems={'end'}>
              <View
                style={[styles.totalPointWrapper, props.compact ? styles.totalPointWrapperCompact : undefined]}
                paddingHorizontal={'10'}>
                <Text
                  style={totalPointStyle}
                  fontSize={totalPointFont.fontSize}
                  lineHeight={totalPointFont.lineHeight}
                  fontWeight={'bold'}
                  color={colors.white}
                  numberOfLines={1}>
                  {totalPointValue}
                </Text>
              </View>

              <View
                style={[styles.currentTotalPoint, props.compact ? styles.currentTotalPointCompact : undefined]}
                paddingHorizontal={'10'}>
                <Text
                  style={styles.currentPointText}
                  fontSize={props.compact ? 22 : 32}
                  lineHeight={props.compact ? 26 : 38}
                  fontWeight={'bold'}>
                  {player.proMode?.currentPoint || 0}
                </Text>
              </View>
            </View>
          </View>
        </View>
      );
    },
    [props.currentPlayerIndex, getTotalPointFont],
  );

  if (!props.gameSettings.mode?.countdownTime) {
    return <View />;
  }

  return (
    <View
      style={[styles.container, props.compact ? styles.containerCompact : undefined]}
      direction={'row'}
      marginTop={props.compact ? '0' : '10'}>
      <View flex={'1'}>
        <View
          collapsable={false}
          style={styles.countdownContainer}
          direction={'row'}>
          <View>
            <View
              flex={'1'}
              justify={'center'}
              style={[styles.totalTurnWrapper, props.compact ? styles.totalTurnWrapperCompact : undefined]}
              paddingHorizontal={props.compact ? '12' : '20'}>
              <Text
                color={colors.white}
                fontSize={props.compact ? 40 : 56}
                lineHeight={props.compact ? 46 : 70}>
                {Math.max(1, Number(props.totalTurns || 1))}
              </Text>
            </View>
          </View>

          <View flex={'1'}>
            {renderPlayer(viewModel.player0, 0, styles.totalPointText0)}
            {renderPlayer(viewModel.player1, 1, styles.totalPointText1)}
          </View>
        </View>

        <View
          collapsable={false}
          style={styles.countdownContainer}
          direction={'row'}
          alignItems={'center'}>
          <View
            style={[
              styles.countdownWrapper,
              props.compact ? styles.countdownWrapperCompact : undefined,
              {
                transform: [{translateX: caromTimerTextOffset}],
                zIndex: 2,
                elevation: 2,
              },
            ]}
            paddingHorizontal={props.compact ? '12' : '20'}
            marginLeft={props.compact ? '2' : '5'}>
            <Text fontSize={props.compact ? 16 : 20} color={colors.white}>
              {props.countdownTime}
            </Text>
          </View>

          <View
            flex={'1'}
            direction={'row'}
            alignItems={'center'}
            justify={'center'}>
            <View
              style={{width: '100%'}}
              paddingLeft={'10'}
              paddingRight={'10'}
              alignItems={'center'}>
              <Countdown
                originalCountdownTime={props.gameSettings.mode?.countdownTime}
                currentCountdownTime={props.countdownTime}
                countdownWidth={countdownBarWidth}
                heightItem={props.compact ? 12 : 27}
                marginHorizontal={props.compact ? 1 : 2}
                direction="right-to-left"
                colorMode="threshold"
                yellowThreshold={10}
                redThreshold={5}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
};

export default memo(CaromInfo);
