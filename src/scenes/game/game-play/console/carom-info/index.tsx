import React, {memo, useCallback, useMemo, useState} from 'react';
import {
  Image as RNImage,
  LayoutChangeEvent,
  Text as RNText,
  TextStyle,
  View as RNView,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

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

const toDisplayText = (value?: unknown) => String(value ?? '').trim();

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

  return nestedTitle || 'TÊN GIẢI';
};

const getPointFont = (point: number, compact?: boolean): TextStyle => {
  const value = Math.abs(Number(point || 0));

  if (value >= 1000) {
    return {fontSize: compact ? 18 : 24, lineHeight: compact ? 22 : 29};
  }
  if (value >= 100) {
    return {fontSize: compact ? 22 : 30, lineHeight: compact ? 27 : 35};
  }
  return {fontSize: compact ? 29 : 42, lineHeight: compact ? 34 : 49};
};

const getLayoutMetrics = (rawWidth: number, forceCompact?: boolean) => {
  const boardWidth = Math.max(260, Math.round(rawWidth || 420));
  const compact = !!forceCompact || boardWidth <= 360;
  const line = compact ? 2 : 3;

  const headerHeight = compact ? 30 : Math.round(clamp(boardWidth * 0.083, 36, 46));
  const playerRowHeight = compact ? 38 : Math.round(clamp(boardWidth * 0.125, 52, 70));
  const countdownHeight = compact ? 34 : Math.round(clamp(boardWidth * 0.086, 38, 48));

  const runWidth = compact
    ? Math.round(clamp(boardWidth * 0.125, 42, 56))
    : Math.round(clamp(boardWidth * 0.135, 58, 76));
  const scoreWidth = compact
    ? Math.round(clamp(boardWidth * 0.145, 48, 66))
    : Math.round(clamp(boardWidth * 0.155, 66, 86));
  const rightGroupWidth = scoreWidth + runWidth;
  const nameWidth = Math.max(0, boardWidth - rightGroupWidth);

  const totalHeight = headerHeight + playerRowHeight * 2 + countdownHeight;
  const bodyTop = headerHeight;
  const firstPlayerDividerTop = headerHeight + playerRowHeight;
  const countdownTop = headerHeight + playerRowHeight * 2;
  const nameScoreX = nameWidth;
  const scoreRunX = nameWidth + scoreWidth;

  return {
    boardWidth,
    compact,
    line,
    headerHeight,
    playerRowHeight,
    countdownHeight,
    runWidth,
    scoreWidth,
    rightGroupWidth,
    nameWidth,
    totalHeight,
    bodyTop,
    firstPlayerDividerTop,
    countdownTop,
    nameScoreX,
    scoreRunX,
  };
};

const CaromInfo = (props: Props) => {
  const viewModel = CaromInfoViewModel(props);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  const players = useMemo(
    () => [viewModel.player0, viewModel.player1].filter(Boolean) as Player[],
    [viewModel.player0, viewModel.player1],
  );

  const tournamentTitle = useMemo(
    () => getTournamentTitle(props.gameSettings).toUpperCase(),
    [props.gameSettings],
  );

  const goalText = useMemo(
    () => `${Number(
      props.goal || props.gameSettings?.players?.goal?.goal || props.playerSettings?.goal?.goal || 0,
    )}`,
    [props.gameSettings?.players?.goal?.goal, props.goal, props.playerSettings?.goal?.goal],
  );

  const innText = useMemo(() => `${Math.max(1, Number(props.totalTurns || 1))}`, [props.totalTurns]);

  const countdownTotal = Math.max(0, Number(props.gameSettings?.mode?.countdownTime || 0));
  const countdownValue = Math.max(
    0,
    Number(typeof props.countdownTime === 'number' ? props.countdownTime : countdownTotal),
  );
  const countdownPercent = countdownTotal
    ? `${clamp((countdownValue / countdownTotal) * 100, 0, 100)}%`
    : '100%';

  const metrics = useMemo(
    () => getLayoutMetrics(measuredWidth, props.compact),
    [measuredWidth, props.compact],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width || 0);
    if (width > 0) {
      setMeasuredWidth(currentWidth => (Math.abs(currentWidth - width) > 1 ? width : currentWidth));
    }
  }, []);

  const renderFlag = useCallback(
    (player: Player) => {
      const flagImage = getPlayerFlagImageSource(player as any);
      const flagText = getPlayerFlagText(player as any);

      return (
        <RNView style={[styles.flagBadge, metrics.compact ? styles.flagBadgeCompact : undefined]}>
          {flagImage ? (
            <RNImage source={flagImage} resizeMode="cover" fadeDuration={0} style={styles.flagImage} />
          ) : (
            <RNText style={styles.flagText} numberOfLines={1}>
              {flagText}
            </RNText>
          )}
        </RNView>
      );
    },
    [metrics.compact],
  );

  const renderPlayer = useCallback(
    (player: Player, index: number) => {
      const isCurrentPlayer = Number(props.currentPlayerIndex || 0) === index;
      const totalPointValue = Number(player.totalPoint || 0);
      const currentPointValue = Number(player.proMode?.currentPoint || 0);
      const pointFont = getPointFont(totalPointValue, metrics.compact);

      return (
        <RNView style={[styles.playerRow, {height: metrics.playerRowHeight}]}>
          <RNView style={[styles.playerNameCell, {width: metrics.nameWidth}]}>
            {renderFlag(player)}
            <RNText
              style={[styles.playerNameText, metrics.compact ? styles.playerNameTextCompact : undefined]}
              numberOfLines={1}>
              {String(player.name || '').toUpperCase()}
            </RNText>
          </RNView>

          <RNView style={[styles.scoreCell, {width: metrics.scoreWidth}]}>
            <RNText style={[styles.scoreText, pointFont]} numberOfLines={1}>
              {totalPointValue}
            </RNText>
          </RNView>

          <RNView style={[styles.runCell, {width: metrics.runWidth}]}>
            {isCurrentPlayer ? (
              <RNView style={[styles.currentRunBadge, metrics.compact ? styles.currentRunBadgeCompact : undefined]}>
                <RNText
                  style={[styles.currentRunText, metrics.compact ? styles.currentRunTextCompact : undefined]}
                  numberOfLines={1}>
                  {currentPointValue}
                </RNText>
              </RNView>
            ) : null}
          </RNView>
        </RNView>
      );
    },
    [metrics.compact, metrics.nameWidth, metrics.playerRowHeight, metrics.runWidth, metrics.scoreWidth, props.currentPlayerIndex, renderFlag],
  );

  if (!countdownTotal || players.length < 2) {
    return <RNView />;
  }

  return (
    <RNView
      onLayout={onLayout}
      style={[styles.container, props.compact ? styles.containerCompact : undefined]}>
      <RNView style={[styles.boardContent, {height: metrics.totalHeight}]}>
        <RNView style={[styles.headerRow, {height: metrics.headerHeight}]}>
          <RNView style={[styles.headerTitleCell, {width: metrics.nameWidth}]}>
            <RNText style={[styles.headerTitleText, metrics.compact ? styles.headerTitleTextCompact : undefined]} numberOfLines={1}>
              {tournamentTitle}
            </RNText>
            <RNText style={[styles.headerGoalText, metrics.compact ? styles.headerGoalTextCompact : undefined]} numberOfLines={1}>
              [{goalText}]
            </RNText>
          </RNView>

          <RNView style={[styles.headerTurnGroupCell, {width: metrics.rightGroupWidth}]}>
            <RNText style={[styles.headerInnText, metrics.compact ? styles.headerInnTextCompact : undefined]} numberOfLines={1}>
              Lượt {innText}
            </RNText>
          </RNView>
        </RNView>

        <RNView style={styles.playersTable}>
          {renderPlayer(players[0], 0)}
          {renderPlayer(players[1], 1)}
        </RNView>

        <RNView style={[styles.countdownRow, {height: metrics.countdownHeight}]}>
          <RNView style={styles.countdownTrack}>
            <RNView style={[styles.countdownFillClip, {width: countdownPercent}]}> 
              <LinearGradient
                colors={['#FF2727', '#FF971D', '#DDF01F', '#14F836']}
                start={{x: 0, y: 0.5}}
                end={{x: 1, y: 0.5}}
                style={styles.countdownFill}
              />
            </RNView>
          </RNView>

          <RNView style={styles.countdownTextCell}>
            <RNText style={[styles.countdownText, metrics.compact ? styles.countdownTextCompact : undefined]} numberOfLines={1}>
              {countdownValue}
            </RNText>
          </RNView>
        </RNView>

        <RNView
          pointerEvents="none"
          style={[
            styles.absoluteLineHorizontal,
            {top: metrics.headerHeight, height: metrics.line},
          ]}
        />
        <RNView
          pointerEvents="none"
          style={[
            styles.absoluteLineHorizontal,
            {top: metrics.firstPlayerDividerTop, height: metrics.line},
          ]}
        />
        <RNView
          pointerEvents="none"
          style={[
            styles.absoluteLineHorizontal,
            {top: metrics.countdownTop, height: metrics.line},
          ]}
        />
        <RNView
          pointerEvents="none"
          style={[
            styles.absoluteLineVertical,
            {
              left: metrics.nameWidth,
              top: 0,
              height: metrics.headerHeight,
              width: metrics.line,
            },
          ]}
        />
        <RNView
          pointerEvents="none"
          style={[
            styles.absoluteLineVertical,
            {
              left: metrics.nameScoreX,
              top: metrics.bodyTop,
              height: metrics.playerRowHeight * 2,
              width: metrics.line,
            },
          ]}
        />
        <RNView
          pointerEvents="none"
          style={[
            styles.absoluteLineVertical,
            {
              left: metrics.scoreRunX,
              top: metrics.bodyTop,
              height: metrics.playerRowHeight * 2,
              width: metrics.line,
            },
          ]}
        />
      </RNView>
    </RNView>
  );
};

export default memo(CaromInfo);
