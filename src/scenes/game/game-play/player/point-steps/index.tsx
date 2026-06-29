import View from 'components/View';
import React, {memo, useMemo} from 'react';
import styles from './styles';
import Button from 'components/Button';
import {GameSettings} from 'types/settings';
import {
  GAME_PLAY_POINTS_STEPS,
  GAME_PLAY_POINTS_STEPS_SHORT,
} from 'constants/game-play';
import {scale as responsiveScale} from 'utils/responsive';
import Text from 'components/Text';
import {isPoolGame} from 'utils/game';

interface Props {
  gameSettings?: GameSettings;
  onPressPointStep: (addedPoint: number) => void;
}

const PointSteps = (props: Props) => {
  const PAIR_PLAY = useMemo(
    () => props.gameSettings?.players?.playingPlayers?.length === 2,
    [props.gameSettings?.players?.playingPlayers?.length],
  );

  const STEPS = useMemo(() => {
    return props.gameSettings?.category === 'libre' &&
      (props.gameSettings?.mode?.mode === 'fast' ||
      props.gameSettings?.mode?.mode === 'quick_match')
      ? GAME_PLAY_POINTS_STEPS
      : GAME_PLAY_POINTS_STEPS_SHORT;
  }, [props.gameSettings?.category, props.gameSettings?.mode?.mode]);

  if (
    !(props.gameSettings?.mode?.mode === 'fast' ||
      props.gameSettings?.mode?.mode === 'quick_match') ||
    isPoolGame(props.gameSettings?.category)
  ) {
    return <View />;
  }

  return (
    <View direction={'row'}>
      <View
        flex={'1'}
        style={styles.stepsWrapper}
        direction={'row'}
        alignItems={'center'}
        justify={'center'}
        marginLeft={'15'}>
        {Object.keys(STEPS).map((key, index) => {
          return (
            <Button
              key={`game-step-${index}`}
              style={[
                styles.buttonStep,
                {
                  paddingVertical: PAIR_PLAY
                    ? responsiveScale(15)
                    : responsiveScale(0),
                },
              ]}
              onPress={props.onPressPointStep.bind(
                PointSteps,
                (STEPS as any)[key],
              )}>
              <Text fontSize={PAIR_PLAY ? 32 : 24}>+{(STEPS as any)[key]}</Text>
            </Button>
          );
        })}
      </View>
    </View>
  );
};

export default memo(PointSteps);
