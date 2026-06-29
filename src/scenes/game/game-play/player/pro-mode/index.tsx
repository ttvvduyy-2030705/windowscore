import React, {memo} from 'react';
import Button from 'components/Button';
import Text from 'components/Text';
import View from 'components/View';
import useAdaptiveLayout from 'scenes/game/useAdaptiveLayout';
import i18n from 'i18n';

import {GameSettings} from 'types/settings';

import {isPoolGame} from 'utils/game';

import playerStyles from '../styles';
import styles from './styles';

interface Props {
  gameSettings?: GameSettings;
  isOnTurn: boolean;
  totalPointInTurn: number;
  onEndTurn: (isPrevious?: boolean) => void;
}

const ProMode = (props: Props) => {
  const adaptive = useAdaptiveLayout();
  const valueFontSize = adaptive.fs(26, 0.76, 1.04);

  if (
    (props.gameSettings?.mode?.mode === 'fast' ||
      props.gameSettings?.mode?.mode === 'quick_match') ||
    isPoolGame(props.gameSettings?.category)
  ) {
    return <View />;
  }

  return (
    <View direction={'row'}>
      <View flex={'1'} direction={'row'} justify={'between'} alignItems={'end'}>
        {props.isOnTurn ? (
          <Button
            style={playerStyles.buttonEndTurn}
            onPress={props.onEndTurn.bind(ProMode, undefined)}>
            <Text fontSize={valueFontSize}>{i18n.t('turn')}</Text>
          </Button>
        ) : (
          <View style={playerStyles.buttonEndTurnEmpty} />
        )}
        <View style={styles.totalPointInTurn} paddingVertical={'10'}>
          <Text fontSize={valueFontSize} fontWeight={'bold'}>
            {props.totalPointInTurn}
          </Text>
        </View>
      </View>
    </View>
  );
};

export default memo(ProMode);
