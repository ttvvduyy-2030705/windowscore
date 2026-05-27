import {DeviceEventEmitter, NativeModules} from 'react-native';

const nativeRemote =
  NativeModules.RemoteControl ??
  NativeModules.RemoteControlModule ??
  NativeModules.AplusRemoteControl;

class BluetoothWindowsService {
  isPermissionsGranted = true;

  requestBluetoothPermissions = async () => true;

  scanAndConnect = async () => {
    try {
      nativeRemote?.setEnabled?.(true);
      return await nativeRemote?.scanAndConnect?.();
    } catch (error) {
      if (__DEV__) {
        console.log('[Bluetooth][Windows] scanAndConnect failed:', error);
      }
      return undefined;
    }
  };

  disconnect = async () => {
    try {
      return await nativeRemote?.disconnect?.();
    } catch (error) {
      if (__DEV__) {
        console.log('[Bluetooth][Windows] disconnect failed:', error);
      }
      return undefined;
    }
  };

  addStatusListener = (callback: (data: any) => void) =>
    DeviceEventEmitter.addListener('onRemoteStatus', callback);

  addNotificationListener = (callback: (data: any) => void) =>
    DeviceEventEmitter.addListener('onRemoteBluetoothNotification', callback);

  destroy = () => undefined;
}

const BluetoothWindows = new BluetoothWindowsService();

export default BluetoothWindows;
export const BLEService = BluetoothWindows;
