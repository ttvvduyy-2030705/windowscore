import AsyncStorage from '@react-native-async-storage/async-storage';
import {NativeModules, Platform} from 'react-native';

const APLUS_PRO_DEVICE_ID_KEY = '@aplus_pro_device_instance_id_v1';

const randomPart = () => Math.random().toString(16).slice(2);

const createDeviceInstanceId = () => {
  const cryptoApi = (global as any)?.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  return `${Date.now().toString(16)}-${randomPart()}-${randomPart()}-${randomPart()}`;
};

export const getAplusProDeviceInstanceId = async () => {
  const existing = await AsyncStorage.getItem(APLUS_PRO_DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const created = createDeviceInstanceId();
  await AsyncStorage.setItem(APLUS_PRO_DEVICE_ID_KEY, created);
  return created;
};

export const getAplusProDeviceInfo = () => {
  const platformConstants = NativeModules?.PlatformConstants || {};
  const brand =
    platformConstants.Brand ||
    platformConstants.Manufacturer ||
    platformConstants.brand ||
    platformConstants.manufacturer ||
    '';
  const model =
    platformConstants.Model ||
    platformConstants.model ||
    platformConstants.DeviceName ||
    '';

  return {
    platform: Platform.OS,
    brand: String(brand || ''),
    model: String(model || ''),
    osVersion: String(Platform.Version || ''),
    appVersion: '',
  };
};
