import React, {memo, RefObject, useCallback} from 'react';
import View from 'components/View';
import {GameSettings, GameSettingsMode} from 'types/settings';
import Text from 'components/Text';
import i18n from 'i18n';
import colors from 'configuration/colors';
import Button from 'components/Button';
import {isCaromGame, isPoolGame} from 'utils/game';
import styles from './styles';
import Webcam from '../webcam';
import {Camera} from 'react-native-vision-camera';

interface Props {
  isStarted: boolean;
  webcamFolderName?: string;
  goal: number;
  totalTurns: number;
  totalPlayers: number;
  currentMode: GameSettingsMode;
  gameSettings: GameSettings;
  onPressGiveMoreTime: () => void;
  updateWebcamFolderName: (name: string) => void;
  //renderMatchInfo: () => React.ReactNode;
  onIncreaseTotalTurns: () => void;
  onDecreaseTotalTurns: () => void;
  onSwapPlayers: () => void;
  isPaused: boolean;
  isCameraReady: boolean;
  setIsCameraReady: (isReady: boolean) => void;
  cameraRef: RefObject<Camera>;
}

const GameInfo = (props: Props) => {
  const isFullPlayer = props.totalPlayers === 5;

  const renderPoint = useCallback((title: string, value: number) => {
    return (
      <View
        flex={'1'}
        direction={'row'}
        alignItems={'center'}
        justify={'center'}
        style={styles.pointWrapper}>
        <Text style={styles.pointLabel} fontSize={16}>
          {title}
        </Text>
        <Text style={styles.pointColon} fontSize={16}>
          :
        </Text>
        <View style={styles.valueWrapper}>
          <Text
            style={styles.valueText}
            fontSize={30}
            adjustsFontSizeToFit={true}
            color={colors.grayBlue}
            fontWeight={'bold'}>
            {value}
          </Text>
        </View>
      </View>
    );
  }, []);

  const renderBigPoint = useCallback((title: string, value: number) => {
    return (
      <View
        flex={'1'}
        direction={'row'}
        alignItems={'center'}
        justify={'center'}
        style={styles.pointWrapper}>
        <Text fontSize={60}>{title}</Text>
        <View
          style={styles.valueWrapper}
          direction={'row'}
          alignItems={'center'}
          marginLeft={'5'}>
          <Text
            style={styles.valueText}
            fontSize={120}
            adjustsFontSizeToFit={true}
            color={colors.grayBlue}
            fontWeight={'bold'}>
            {value}
          </Text>
        </View>
      </View>
    );
  }, []);

  if (isFullPlayer && (props.currentMode?.mode === 'fast' || props.currentMode?.mode === 'quick_match')) {
    return <View />;
  }

  if ((props.currentMode?.mode === 'fast' || props.currentMode?.mode === 'quick_match')) {
    return (
      <View
        flex={isFullPlayer ? '0' : '1'}
        direction={'row'}
        alignItems={'center'}>
        {renderBigPoint(i18n.t('goal'), props.goal)}
      </View>
    );
  }

  return (
    <View flex={isFullPlayer ? '0' : '1'}>
      {!isCaromGame(props.gameSettings.category) && (
        <View flex={isFullPlayer ? '0' : '1'} direction={'row'}>
          {renderPoint(i18n.t('totalTurns'), props.totalTurns)}
          {renderPoint(i18n.t('goal'), props.goal)}
        </View>
      )}

      {isCaromGame(props.gameSettings.category) &&
      props.totalPlayers < 5 &&
      props.currentMode?.mode === 'pro' ? (
        <Webcam
          setIsCameraReady={props.setIsCameraReady}
          isCameraReady={props.isCameraReady}
          webcamFolderName={props.webcamFolderName}
          // enderMatchInfo={props.renderMatchInfo}
          updateWebcamFolderName={props.updateWebcamFolderName}
          cameraRef={props.cameraRef}
          isPaused={props.isPaused}
          isStarted={props.isStarted}
        />
      ) : (
        <View />
      )}

      {isCaromGame(props.gameSettings.category) && (
        <View flex={isFullPlayer ? '0' : '1'} direction={'row'}>
          {renderPoint(i18n.t('totalTurns'), props.totalTurns)}
          {renderPoint(i18n.t('goal'), props.goal)}
        </View>
      )}

      {/* {(isCaromGame(props.gameSettings.category) && !props.isStarted) &&
        <View
        flex={'1'}
        direction={'row'}
        justify={'center'}
        alignItems={'center'}>
          <Button
            style={[styles.button, styles.buttonBorder]}
            onPress={props.onSwapPlayers}>
            <Text>{i18n.t('switchPlayer')}</Text>
          </Button>
        </View>
      } */}

      {isCaromGame(props.gameSettings.category) && (
        <View style={styles.buttonWrapper} direction={'row'} alignItems={'end'}>
          {props.isStarted ? (
            <>
              <Button
                style={[styles.button, styles.buttonTurns]}
                onPress={props.onIncreaseTotalTurns}>
                <Text color={colors.white} fontSize={16}>
                  {i18n.t('increaseTotalTurns')}
                </Text>
              </Button>
              <Button
                onPress={props.onPressGiveMoreTime}
                style={[styles.button, styles.buttonGiveMoreTime]}>
                <Text color={colors.white} fontSize={16}>
                  {i18n.t('giveMoreTime')}
                </Text>
              </Button>
              <Button
                style={[styles.button, styles.buttonTurns]}
                onPress={props.onDecreaseTotalTurns}>
                <Text color={colors.white} fontSize={16}>
                  {i18n.t('decreaseTotalTurns')}
                </Text>
              </Button>
            </>
          ) : (
            <View
              flex={'1'}
              direction={'row'}
              justify={'center'}
              alignItems={'center'}>
              <Button
                style={[styles.button, styles.buttonSwapPlayers]}
                onPress={props.onSwapPlayers}>
                <Text>{i18n.t('switchPlayer')}</Text>
              </Button>
            </View>
          )}
        </View>
      )}

      {/* {(isCaromGame(props.gameSettings.category) && props.isStarted) && (
                  <View direction={'row'} marginHorizontal={'20'} marginTop={'10'}>
                    <View
                      flex={'1'}
                      direction={'row'}
                      justify={'center'}
                      alignItems={'center'}>
                      <Button
                        style={[styles.button]}
                        onPress={props.onIncreaseTotalTurns}>
                        <Text>{i18n.t('increaseTotalTurns')}</Text>
                      </Button>
                      <View marginHorizontal={'10'} />
                      <Button
                        style={[styles.button]}
                        onPress={props.onDecreaseTotalTurns}>
                        <Text>{i18n.t('decreaseTotalTurns')}</Text>
                      </Button>
                    </View>
                  </View>
                )
              } */}

      {/* {isCaromGame(props.gameSettings.category) && props.isStarted && (
        <View style={styles.buttonWrapper} direction={'row'} alignItems={'end'}>
          <Button
            onPress={props.onPressGiveMoreTime}
            style={[styles.button, styles.buttonGiveMoreTime]}>
            <Text color={colors.white} fontSize={16}>
              {i18n.t('giveMoreTime')}
            </Text>
          </Button>
        </View>
      )
      } */}
    </View>
  );
};

export default memo(GameInfo);
