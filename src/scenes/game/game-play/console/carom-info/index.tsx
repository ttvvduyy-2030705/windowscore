import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
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



const MarqueeText = ({
  text,
  textStyle,
  compact = false,
  gap = 10,
  pxPerSecond = 32,
}: {
  text: string;
  textStyle: any;
  compact?: boolean;
  gap?: number;
  pxPerSecond?: number;
}) => {
  const scrollX = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<any>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [measuredTextWidth, setMeasuredTextWidth] = useState(0);

  const displayText = String(text || '').trim();
  const normalizedLength = displayText.length;

  // RN Windows có lúc đo text ngắn hơn thực tế, nên dùng fallback rộng hơn.
  // Quan trọng: tuyệt đối không dùng ellipsize tail cho chữ chạy.
  const estimatedCharWidth = compact ? 10.5 : 14;
  const estimatedTextWidth = Math.ceil(normalizedLength * estimatedCharWidth);
  const safeTextWidth = Math.max(measuredTextWidth, estimatedTextWidth);
  const shouldScroll =
    viewportWidth > 0 &&
    normalizedLength > 12 &&
    safeTextWidth > viewportWidth - 4;

  // Một segment = đúng chiều rộng chữ + khoảng cách nhỏ.
  // Chạy từ 0 đến -segmentWidth thì segment kế tiếp nối vào ngay.
  const textBoxWidth = shouldScroll ? safeTextWidth + 8 : 0;
  const segmentWidth = shouldScroll ? textBoxWidth + gap : 0;
  const segmentCount = shouldScroll ? 5 : 1;

  useEffect(() => {
    let mounted = true;

    animationRef.current?.stop?.();
    animationRef.current = null;
    scrollX.stopAnimation();
    scrollX.setValue(0);

    if (!shouldScroll || segmentWidth <= 0) {
      return undefined;
    }

    const duration = Math.max(
      5000,
      Math.round((segmentWidth / Math.max(16, pxPerSecond)) * 1000),
    );

    const run = () => {
      if (!mounted) {
        return;
      }

      scrollX.setValue(0);
      animationRef.current = Animated.timing(scrollX, {
        toValue: -segmentWidth,
        duration,
        easing: Easing.linear,
        useNativeDriver: false,
      });

      animationRef.current.start(({finished}: {finished: boolean}) => {
        if (finished && mounted) {
          requestAnimationFrame(run);
        }
      });
    };

    const timer = setTimeout(run, 250);

    return () => {
      mounted = false;
      clearTimeout(timer);
      animationRef.current?.stop?.();
      animationRef.current = null;
      scrollX.stopAnimation();
      scrollX.setValue(0);
    };
  }, [displayText, pxPerSecond, scrollX, segmentWidth, shouldScroll]);

  return (
    <RNView
      onLayout={event => {
        const width = Math.round(event.nativeEvent.layout.width || 0);
        setViewportWidth(current =>
          Math.abs(current - width) > 1 ? width : current,
        );
      }}
      style={styles.headerTitleMarqueeViewport}>
      <RNText
        pointerEvents="none"
        onLayout={event => {
          const width = Math.ceil(event.nativeEvent.layout.width || 0);
          if (width > 0) {
            setMeasuredTextWidth(current =>
              Math.abs(current - width) > 1 ? width : current,
            );
          }
        }}
        style={[textStyle, styles.headerTitleMeasureText]}
        numberOfLines={1}
        ellipsizeMode="clip">
        {displayText}
      </RNText>

      {!shouldScroll ? (
        <RNText style={textStyle} numberOfLines={1} ellipsizeMode="clip">
          {displayText}
        </RNText>
      ) : (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.headerTitleMarqueeInner,
            {
              width: segmentWidth * segmentCount,
              transform: [{translateX: scrollX}],
            },
          ]}>
          {Array.from({length: segmentCount}).map((_, index) => (
            <RNView
              key={`title-marquee-loop-${index}`}
              style={[
                styles.headerTitleMarqueeSegment,
                {width: segmentWidth},
              ]}>
              <RNText
                style={[textStyle, {width: textBoxWidth}]}
                numberOfLines={1}
                ellipsizeMode="clip">
                {displayText}
              </RNText>
              <RNView style={{width: gap, flexShrink: 0}} />
            </RNView>
          ))}
        </Animated.View>
      )}
    </RNView>
  );
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
            <MarqueeText
              text={tournamentTitle}
              compact={metrics.compact}
              textStyle={[
                styles.headerTitleMarqueeText,
                metrics.compact ? styles.headerTitleMarqueeTextCompact : undefined,
              ]}
            />
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
