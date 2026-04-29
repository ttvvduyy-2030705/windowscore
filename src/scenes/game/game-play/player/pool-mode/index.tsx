import React, {memo, useContext} from 'react';

import Button from 'components/Button';
import Text from 'components/Text';
import View from 'components/View';

import useAdaptiveLayout from 'scenes/game/useAdaptiveLayout';
import colors from 'configuration/colors';
import i18n from 'i18n';
import {isPoolGame} from 'utils/game';
import {GameSettings} from 'types/settings';
import {Player} from 'types/player';
import {LanguageContext} from 'context/language';

import playerStyles from '../styles';
import styles from './styles';

interface Props {
  gameSettings?: GameSettings;
  isOnTurn: boolean;
  player: Player;
  onEndTurn: (isPrevious?: boolean) => void;
  onViolate: () => void;
  onResetViolate: () => void;
}

const PoolMode = ({
  gameSettings,
  isOnTurn,
  player,
  onEndTurn,
  onViolate,
  onResetViolate,
}: Props) => {
  const {language} = useContext(LanguageContext);
  void language;
  const adaptive = useAdaptiveLayout();
  const buttonFontSize = adaptive.fs(26, 0.76, 1.04);

  if (!isPoolGame(gameSettings?.category)) {
    return <View />;
  }

  const locale = String((i18n as any)?.locale || (i18n as any)?.language || '')
    .toLowerCase();
  const isEnglish = locale.startsWith('en');

  return (
    <View direction={'row'}>
      <View flex={'1'} direction={'row'} justify={'between'} alignItems={'end'}>
        {isOnTurn ? (
          <Button
            style={playerStyles.buttonEndTurn}
            onPress={onEndTurn.bind(PoolMode, undefined)}>
            <Text color={colors.white} fontSize={buttonFontSize}>
              {isEnglish ? 'Switch turn' : 'Đổi lượt đánh'}
            </Text>
          </Button>
        ) : (
          <View style={playerStyles.buttonEndTurnEmpty} />
        )}

        <View direction={'row'} alignItems={'center'} marginRight={'15'} marginBottom={'10'}>
          <Button
            style={styles.buttonViolate}
            onPress={onViolate}
            onLongPress={onResetViolate}>
            <Text
              style={styles.textX}
              color={colors.white}
              fontWeight={'bold'}
              fontSize={48}>
              {'X'}
            </Text>
          </Button>

          <View marginLeft={'10'}>
            <Text fontSize={64} lineHeight={64} style={styles.textViolate}>
              {player.violate || 0}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

export default memo(PoolMode);
