import React, {memo} from 'react';

import View from 'components/View';
import Image from 'components/Image';

import images from 'assets';
import {Player} from 'types/player';
import {GameSettings} from 'types/settings';

import styles from './styles';

interface Props {
  gameSettings?: GameSettings;
  player: Player;
}

const ExtraTimeTurns = ({gameSettings, player}: Props) => {
  const totalExtra = Number(player.proMode?.extraTimeTurns || 0);

  if (
    !gameSettings?.mode?.extraTimeTurns ||
    gameSettings?.mode?.extraTimeTurns === 'infinity' ||
    (gameSettings?.mode?.mode === 'fast' ||
      gameSettings?.mode?.mode === 'quick_match') ||
    totalExtra <= 0
  ) {
    return <View />;
  }

  return (
    <View style={styles.extraTimeTurnsContainer}>
      {Array.from({length: totalExtra}, (_, index) => {
        return (
          <View key={`extra-time-turn-${index}`} style={styles.extraTimeTurn}>
            <Image
              source={images.game.addTime}
              style={styles.extraTimeIcon}
              resizeMode={'contain'}
            />
          </View>
        );
      })}
    </View>
  );
};

export default memo(ExtraTimeTurns);
