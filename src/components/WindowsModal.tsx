import React, {useEffect} from 'react';
import {StyleSheet, View} from 'react-native';

type Props = {
  visible?: boolean;
  children?: React.ReactNode;
  onShow?: () => void;
  onRequestClose?: () => void;
  transparent?: boolean;
  animationType?: 'none' | 'slide' | 'fade';
  statusBarTranslucent?: boolean;
  presentationStyle?: string;
};

const WindowsModal = ({visible, children, onShow}: Props) => {
  useEffect(() => {
    if (visible) {
      onShow?.();
    }
  }, [visible, onShow]);

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.root} pointerEvents="box-none">
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
  },
});

export default WindowsModal;