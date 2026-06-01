import {RemoteControlModule} from 'services/native-modules';
import {RemoteControlKeys, RemoteControlKeysNative} from 'types/bluetooth';

const DEBUG_REMOTE = true;
const debugRemoteLog = (...args: any[]) => {
  if (__DEV__ && DEBUG_REMOTE) {
    console.log(...args);
  }
};

class RemoteControl {
  private static _instance: RemoteControl;
  private _keyEvents: {[key: string]: Function | null} = {};
  private _registeredToNative = false;

  private constructor() {
    this.initializeKeySlots();
    this.ensureNativeListener();
  }

  public static get instance() {
    return this._instance || (this._instance = new this());
  }

  private initializeKeySlots = () => {
    const enumKeys = Object.keys(RemoteControlKeys);
    const enumValues = Object.values(RemoteControlKeys);

    [...enumKeys, ...enumValues].forEach(key => {
      const normalizedKey = this.normalizeKeyCode(key);

      if (!(String(key) in this._keyEvents)) {
        this._keyEvents[String(key)] = null;
      }

      if (!(normalizedKey in this._keyEvents)) {
        this._keyEvents[normalizedKey] = null;
      }
    });
  };

  private ensureNativeListener = () => {
    if (this._registeredToNative) {
      return;
    }

    RemoteControlModule.registerRemoteControlListener(this.onRemoteEvent);
    RemoteControlModule.startListening?.();
    this._registeredToNative = true;
  };

  private normalizeKeyCode = (rawKeyCode: any): string => {
    const raw = String(rawKeyCode ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s\-]+/g, '_');

    const aliasMap: {[key: string]: string} = {
      // Remote-control numeric key codes / mã phím chính
      '19': 'UP',
      '20': 'DOWN',
      '21': 'LEFT',
      '22': 'RIGHT',

      '24': 'EXTENSION',
      '25': 'TIMER',

      '29': 'START',
      '30': 'WARM_UP',
      '31': 'STOP',
      '32': 'BREAK',

      // Phím xác nhận / một số remote khác
      '23': 'NEW_GAME',
      '66': 'NEW_GAME',
      '160': 'NEW_GAME',

      // Giữ tương thích với các map cũ / vendor specific
      '67': 'STOP',
      '82': 'BREAK',

      // Media keys
      '85': 'START',
      '126': 'START',
      '127': 'START',
      '86': 'STOP',
      '87': 'BREAK',
      '90': 'BREAK',
      '88': 'WARM_UP',
      '89': 'WARM_UP',

      // Textual aliases
      LEFT: 'LEFT',
      DPAD_LEFT: 'LEFT',
      ARROW_LEFT: 'LEFT',

      RIGHT: 'RIGHT',
      DPAD_RIGHT: 'RIGHT',
      ARROW_RIGHT: 'RIGHT',

      UP: 'UP',
      DPAD_UP: 'UP',
      ARROW_UP: 'UP',

      DOWN: 'DOWN',
      DPAD_DOWN: 'DOWN',
      ARROW_DOWN: 'DOWN',

      START: 'START',
      PLAY: 'START',
      PLAY_PAUSE: 'START',
      MEDIA_PLAY: 'START',
      MEDIA_PLAY_PAUSE: 'START',
      MEDIA_PAUSE: 'START',

      STOP: 'STOP',
      MEDIA_STOP: 'STOP',

      BREAK: 'BREAK',
      MEDIA_NEXT: 'BREAK',
      MEDIA_FAST_FORWARD: 'BREAK',

      WARM: 'WARM_UP',
      WARMUP: 'WARM_UP',
      WARM_UP: 'WARM_UP',
      MEDIA_PREVIOUS: 'WARM_UP',
      MEDIA_REWIND: 'WARM_UP',

      TIMER: 'TIMER',
      TIME: 'TIMER',
      CLOCK: 'TIMER',

      EXTENSION: 'EXTENSION',
      EXTRA_TIME: 'EXTENSION',
      ADD_TIME: 'EXTENSION',

      NEWGAME: 'NEW_GAME',
      NEW_GAME: 'NEW_GAME',
      RESET: 'NEW_GAME',
      RESTART: 'NEW_GAME',
      ENTER: 'NEW_GAME',
      OK: 'NEW_GAME',
      DPAD_CENTER: 'NEW_GAME',
      CENTER: 'NEW_GAME',
    };

    return aliasMap[raw] ?? raw;
  };

  private isKeyUpEvent = (data: RemoteControlKeysNative) => {
    const action = String((data as any)?.action ?? (data as any)?.keyAction ?? '')
      .trim()
      .toLowerCase();

    return (
      action === '1' ||
      action === 'up' ||
      action === 'keyup' ||
      action === 'key_up' ||
      action === 'action_up'
    );
  };

  private onRemoteEvent = (data: RemoteControlKeysNative) => {
    if (this.isKeyUpEvent(data)) {
      return;
    }

    const repeatCount = Number((data as any)?.repeatCount ?? 0);
    if (repeatCount > 0) {
      return;
    }

    const rawKeyCode = (data as any)?.keyCode;
    const rawScanCode = (data as any)?.scanCode;
    const rawResolvedKey =
      (data as any)?.key ??
      (data as any)?.resolvedKey ??
      (data as any)?.code;

    const preferredPhysicalCode =
      rawKeyCode ?? rawScanCode ?? rawResolvedKey;

    const normalizedFromCode = this.normalizeKeyCode(preferredPhysicalCode);
    const normalizedFromResolved = this.normalizeKeyCode(rawResolvedKey);

    console.log('[Remote][JS] incoming:', {
      source: (data as any)?.source,
      key: (data as any)?.key,
      keyCode: rawKeyCode,
      scanCode: rawScanCode,
      action: (data as any)?.action,
      repeatCount,
      resolvedKey: rawResolvedKey,
      normalizedFromCode,
      normalizedFromResolved,
    });

    const callback =
      this._keyEvents[normalizedFromCode] ??
      this._keyEvents[String(preferredPhysicalCode)] ??
      this._keyEvents[normalizedFromResolved] ??
      this._keyEvents[String(rawResolvedKey)] ??
      null;

    if (typeof callback !== 'function') {
      console.log('[Remote][JS] no callback for key:', {
        rawKeyCode,
        rawScanCode,
        rawResolvedKey,
        normalizedFromCode,
        normalizedFromResolved,
      });
      return;
    }

    callback();
  };

  public setEnabled = async (enabled: boolean) => {
    this.ensureNativeListener();

    if (__DEV__) {
      console.log('[Remote] setEnabled', enabled);
    }

    // For this Windows Bluetooth remote, enabling the in-game toggle must call
    // the native module. Earlier builds only changed UI state, so native stayed
    // enabled=false and no button event reached the app.
    await RemoteControlModule.setEnabled?.(enabled);

    if (enabled) {
      RemoteControlModule.startListening?.();
    }
  };

  public scanAndConnect = async () => {
    this.ensureNativeListener();
    await RemoteControlModule.setEnabled?.(true);
    return RemoteControlModule.scanAndConnect?.();
  };

  public disconnect = async () => {
    await RemoteControlModule.setEnabled?.(false);
    return RemoteControlModule.disconnect?.();
  };

  public registerKeyEvents = (
    event: RemoteControlKeys | string,
    callback: Function,
  ) => {
    this.ensureNativeListener();
    this.initializeKeySlots();

    const rawEvent = String(event);
    const normalizedEvent = this.normalizeKeyCode(event);

    this._keyEvents[rawEvent] = callback;
    this._keyEvents[normalizedEvent] = callback;
  };

  // Giữ tương thích với code cũ trong GamePlay
  public registerKeyEvent = (
    event: RemoteControlKeys | string,
    callback: Function,
  ) => {
    this.registerKeyEvents(event, callback);
  };

  // Giữ tương thích với code cũ trong GamePlay
  public clearKeyEvent = (event: RemoteControlKeys | string) => {
    const rawEvent = String(event);
    const normalizedEvent = this.normalizeKeyCode(event);

    this._keyEvents[rawEvent] = null;
    this._keyEvents[normalizedEvent] = null;
  };

  public unregisterKeyEvents = (event: RemoteControlKeys | string) => {
    this.clearKeyEvent(event);
  };

  public clearAllKeyEvents = () => {
    Object.keys(this._keyEvents).forEach(key => {
      this._keyEvents[key] = null;
    });
  };

  public removeAllListeners = () => {
    this.clearAllKeyEvents();
    RemoteControlModule.removeAllRemoteControlListeners();
    this._registeredToNative = false;
  };
}

export default RemoteControl;
