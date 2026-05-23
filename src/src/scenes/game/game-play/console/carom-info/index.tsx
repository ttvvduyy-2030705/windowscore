import React, {memo, useCallback, useMemo} from 'react';
import {Image as RNImage, TextStyle} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import View from 'components/View';
import Text from 'components/Text';
import colors from 'configuration/colors';
import {
  getFlagImageSource,
  getFlagText,
  normalizePlayerCountry,
} from 'platform/windows/flags';
import {Player} from 'types/player';

import CaromInfoViewModel, {Props} from './CaromInfoViewModel';
import styles from './styles';

const getPlayerFlagImageSource = (player?: {countryCode?: string; flag?: string}) =>
  getFlagImageSource(normalizePlayerCountry(player as any));

const getPlayerFlagText = (player?: {flag?: string}) =>
  getFlagText(normalizePlayerCountry(player as any));

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const toDisplayText = (value?: unknown) => {
  const text = String(value ?? '').trim();
  return text;
};

const getTournamentTitle = (gameSettings?: any) => {
  const directTitle =
    toDisplayText(gameSettings?.tournamentName) ||
    toDisplayText(gameSettings?.selectedTournamentName) ||
    toDisplayText(gameSettings?.competitionName) ||
    toDisplayText(gameSettings?.eventName) ||
    toDisplayText(gameSettings?.matchTitle) ||
    toDisplayText(gameSettings?.leagueName) ||
    toDisplayText(gameSettings?.title);

  if (directTitle) {
    return directTitle;
  }

  const nestedTitle =
    toDisplayText(gameSettings?.tournament?.name) ||
    toDisplayText(gameSettings?.selectedTournament?.name) ||
    toDisplayText(gameSettings?.event?.name) ||
    toDisplayText(gameSettings?.competition?.name) ||
    toDisplayText(gameSettings?.league?.name);

  return nestedTitle || 'APLUS BILLIARDS';
};

const getPointFont = (point: number, compact?: boolean): TextStyle => {
  const value = Math.abs(Number(point || 0));

  if (value >= 1000) {
    return {
      fontSize: compact ? 24 : 28,
      lineHeight: compact ? 29 : 34,
    };
  }

  if (value >= 100) {
    return {
      fontSize: compact ? 28 : 34,
      lineHeight: compact ? 34 : 40,
    };
  }

  return {
    fontSize: compact ? 34 : 44,
    lineHeight: compact ? 40 : 52,
  };
};

const CaromInfo = (props: Props) => {
  const viewModel = CaromInfoViewModel(props);

  const players = useMemo(
    () => [viewModel.player0, viewModel.player1].filter(Boolean) as Player[],
    [viewModel.player0, viewModel.player1],
  );

  const tournamentTitle = useMemo(
    () => getTournamentTitle(props.gameSettings).toUpperCase(),
    [props.gameSettings],
  );

  const goalText = useMemo(
    () => `${Number(props.goal || props.gameSettings?.players?.goal?.goal || props.playerSettings?.goal?.goal || 0)}`,
    [props.gameSettings?.players?.goal?.goal, props.goal, props.playerSettings?.goal?.goal],
  );

  const innText = useMemo(
    () => `${Math.max(1, Number(props.totalTurns || 1))}`,
    [props.totalTurns],
  );

  const countdownTotal = Number(props.gameSettings?.mode?.countdownTime || 0);
  const countdownValue = Math.max(0, Number(props.countdownTime || 0));
  const countdownPercent = countdownTotal
    ? `${clamp((countdownValue / countdownTotal) * 100, 0, 100)}%`
    : '0%';

  const renderFlag = useCallback(
    (player: Player) => {
      const flagImage = getPlayerFlagImageSource(player as any);
      const flagText = getPlayerFlagText(player as any);

      if (!flagImage && !flagText) {
        return <View style={[styles.flagBadge, props.compact ? styles.flagBadgeCompact : undefined]} />;
      }

      return (
        <View style={[styles.flagBadge, props.compact ? styles.flagBadgeCompact : undefined]}>
          {flagImage ? (
            <RNImage
              source={flagImage}
              resizeMode="cover"
              fadeDuration={0}
              style={styles.flagImage}
            />
          ) : (
            <Text
              style={styles.flagText}
              color={colors.white}
              fontWeight={'900'}
              textAlign={'center'}>
              {flagText}
            </Text>
          )}
        </View>
      );
    },
    [props.compact],
  );

  const renderPlayer = useCallback(
    (player: Player, index: number) => {
      const isCurrentPlayer = Number(props.currentPlayerIndex || 0) === index;
      const totalPointValue = Number(player.totalPoint || 0);
      const currentPointValue = Number(player.proMode?.currentPoint || 0);
      const pointFont = getPointFont(totalPointValue, props.compact);

      return (
        <View style={[styles.playerRow, props.compact ? styles.playerRowCompact : undefined]} direction={'row'}>
          <View style={styles.playerNameCell} direction={'row'} alignItems={'center'}>
            {renderFlag(player)}
            <Text
              style={[styles.playerNameText, props.compact ? styles.playerNameTextCompact : undefined]}
              color={colors.white}
              fontWeight={'900'}
              numberOfLines={1}>
              {String(player.name || '').toUpperCase()}
            </Text>
          </View>

          <View style={styles.scoreCell} alignItems={'center'} justify={'center'}>
            <Text
              style={[styles.scoreText, pointFont]}
              color={colors.white}
              fontWeight={'900'}
              textAlign={'center'}
              numberOfLines={1}>
              {totalPointValue}
            </Text>
          </View>

          <View
            style={[
              styles.runCell,
              props.compact ? styles.runCellCompact : undefined,
            ]}
            alignItems={'center'}
            justify={'center'}>
            {isCurrentPlayer ? (
              <View
                style={[
                  styles.currentRunBadge,
                  props.compact ? styles.currentRunBadgeCompact : undefined,
                ]}
                alignItems={'center'}
                justify={'center'}>
                <Text
                  style={[
                    styles.currentRunText,
                    props.compact ? styles.currentRunTextCompact : undefined,
                  ]}
                  color={'#111111'}
                  fontWeight={'900'}
                  textAlign={'center'}
                  numberOfLines={1}>
                  {currentPointValue}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      );
    },
    [props.compact, props.currentPlayerIndex, renderFlag],
  );

  if (!props.gameSettings.mode?.countdownTime || players.length < 2) {
    return <View />;
  }

  return (
    <View
      style={[
        styles.container,
        props.compact ? styles.containerCompact : undefined,
      ]}>
      <View style={styles.headerRow} direction={'row'}>
        <View style={styles.headerTitleCell} direction={'row'} alignItems={'center'}>
          <Text
            style={[styles.headerTitleText, props.compact ? styles.headerTitleTextCompact : undefined]}
            color={colors.white}
            fontWeight={'900'}
            numberOfLines={1}>
            {tournamentTitle}
          </Text>
          <Text
            style={[styles.headerGoalText, props.compact ? styles.headerGoalTextCompact : undefined]}
            color={colors.white}
            fontWeight={'900'}
            numberOfLines={1}>
            [{goalText}]
          </Text>
        </View>

        <View style={styles.headerInnCell} alignItems={'center'} justify={'center'}>
          <Text
            style={[styles.headerInnText, props.compact ? styles.headerInnTextCompact : undefined]}
            color={colors.white}
            fontWeight={'900'}
            numberOfLines={1}>
            Inn. {innText}
          </Text>
        </View>
      </View>

      <View style={styles.playersTable}>
        {renderPlayer(players[0], 0)}
        {renderPlayer(players[1], 1)}
      </View>

      <View style={styles.countdownRow} direction={'row'} alignItems={'center'}>
        <View style={styles.countdownTrack}>
          <View style={[styles.countdownFillClip, {width: countdownPercent}]}>
            <LinearGradient
              colors={['#03F739', '#E7F31F', '#FF8C1A', '#FF2424']}
              start={{x: 0, y: 0.5}}
              end={{x: 1, y: 0.5}}
              style={styles.countdownFill}
            />
          </View>
        </View>

        <View style={styles.countdownTextCell} alignItems={'center'} justify={'center'}>
          <Text
            style={[styles.countdownText, props.compact ? styles.countdownTextCompact : undefined]}
            color={colors.white}
            fontWeight={'900'}
            textAlign={'center'}
            numberOfLines={1}>
            {countdownValue}
          </Text>
        </View>
      </View>
    </View>
  );
};

export default memo(CaromInfo);
