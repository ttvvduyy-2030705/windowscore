import {NativeModules, NativeEventEmitter} from 'react-native';
import {RemoteControlKeysNative} from 'types/bluetooth';

const RemoteControl =
  NativeModules.RemoteControl ??
  NativeModules.RemoteControlModule ??
  NativeModules.AplusRemoteControl ??
  null;

const RemoteControlEventEmitter = RemoteControl
  ? new NativeEventEmitter(RemoteControl)
  : null;

const eventNames = ['onRemoteKeyDown', 'onRemoteKeyUp'];

const eventHandlers = eventNames.reduce((result, eventName) => {
  result[eventName] = new Map();
  return result;
}, {} as any);

const addEventListener = (
  type: string,
  handler: (data: RemoteControlKeysNative) => void,
) => {
  const handlers = eventHandlers[type];
  if (!handlers || !RemoteControlEventEmitter) {
    console.log(
      '[RemoteControl] native module not available',
      Object.keys(NativeModules || {}).filter(name =>
        /remote/i.test(String(name)),
      ),
    );
    return;
  }

  if (handlers.has(handler)) {
    return;
  }

  handlers.set(handler, RemoteControlEventEmitter.addListener(type, handler));
};

const removeAllRemoteControlListeners = () => {
  if (!RemoteControlEventEmitter) {
    return;
  }

  for (let i = 0; i < eventNames.length; i++) {
    const eventName = eventNames[i];
    const handlers = eventHandlers[eventName];

    handlers?.forEach((subscription: any) => {
      try {
        subscription?.remove?.();
      } catch {}
    });

    handlers?.clear?.();
    RemoteControlEventEmitter.removeAllListeners(eventName);
  }
};

const registerRemoteControlListener = (
  callback: (data: RemoteControlKeysNative) => void,
) => {
  addEventListener('onRemoteKeyDown', callback);
};

const callNative = async (methodName: string, ...args: any[]) => {
  const method = RemoteControl?.[methodName];
  if (typeof method !== 'function') {
    if (__DEV__) {
      console.log('[RemoteControl] native method missing', methodName, Object.keys(RemoteControl || {}));
    }
    return undefined;
  }

  try {
    return await method(...args);
  } catch (error) {
    if (__DEV__) {
      console.log('[RemoteControl] native method failed', methodName, error);
    }
    return undefined;
  }
};

export const RemoteControlModule = {
  registerRemoteControlListener,
  removeAllRemoteControlListeners,
  startListening: () => callNative('startListening'),
  setEnabled: (enabled: boolean) => callNative('setEnabled', enabled),
  scanAndConnect: () => callNative('scanAndConnect'),
  disconnect: () => callNative('disconnect'),
};
