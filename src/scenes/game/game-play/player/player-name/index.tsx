import React, {memo, useEffect, useMemo, useRef} from 'react';
import {TextInput as RNTextInput} from 'react-native';
import View from 'components/View';
import colors from 'configuration/colors';
import Button from 'components/Button';
import Image from 'components/Image';
import images from 'assets';
import {scale as responsiveScale} from 'utils/responsive';
import {Player} from 'types/player';
import styles from './styles';

interface Props {
  totalPlayers?: number;
  player: Player;
  nameEditable: boolean;
  onChangeName: (value: string) => void;
  onToggleEditName: () => void;
}

const PlayerName = (props: Props) => {
  const inputRef = useRef<RNTextInput>(null);
  const isMultiPlayerLayout = (props.totalPlayers ?? 0) > 2;

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }

    if (props.nameEditable) {
      const timeout = setTimeout(() => {
        inputRef.current?.focus();
      }, 0);

      return () => clearTimeout(timeout);
    }

    inputRef.current.blur();
  }, [props.nameEditable]);

  const metrics = useMemo(() => {
    if (isMultiPlayerLayout) {
      return {
        containerHeight: responsiveScale(56),
        inputHeight: responsiveScale(36),
        fontSize: responsiveScale(24),
        lineHeight: responsiveScale(28),
        horizontalPadding: responsiveScale(14),
      };
    }

    return {
      containerHeight: responsiveScale(72),
      inputHeight: responsiveScale(46),
      fontSize: responsiveScale(34),
      lineHeight: responsiveScale(40),
      horizontalPadding: responsiveScale(16),
    };
  }, [isMultiPlayerLayout]);

  const inputStyle = useMemo(
    () => [
      styles.input,
      {
        color: colors.white,
        fontWeight: '700',
        borderBottomColor: props.nameEditable ? '#FF4040' : colors.transparent,
        height: metrics.inputHeight,
        fontSize: metrics.fontSize,
        lineHeight: metrics.lineHeight,
      },
    ],
    [metrics.fontSize, metrics.inputHeight, metrics.lineHeight, props.nameEditable],
  );

  return (
    <View
      style={{
        height: metrics.containerHeight,
        paddingHorizontal: metrics.horizontalPadding,
      }}
      direction={'row'}
      alignItems={'center'}
      marginTop={'4'}
      marginBottom={'4'}>
      <View style={styles.inputWrapper}>
        <RNTextInput
          ref={inputRef}
          style={inputStyle}
          value={props.player.name ?? ''}
          onChangeText={props.onChangeName}
          editable={props.nameEditable}
          autoCorrect={false}
          autoCapitalize="words"
          selectTextOnFocus={props.nameEditable}
          selectionColor={'#FF4040'}
          placeholderTextColor={'#8E9099'}
          multiline={false}
          numberOfLines={1}
          textAlignVertical="center"
        />
      </View>

      <Button style={styles.buttonEdit} onPress={props.onToggleEditName}>
        <Image source={images.game.edit} style={styles.editIcon} />
      </Button>
    </View>
  );
};

export default memo(PlayerName);
