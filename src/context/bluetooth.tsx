import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {BLEService} from 'utils/bluetooth';

type BluetoothContextValue = {
  isBluetoothEnabled: boolean;
  scannedDevices: any[];
  isScanning: boolean;
  startScan: () => void;
  connectToDevice: (_id: string) => Promise<void>;
  connectedDevice: any | null;
  notifications: Record<string, string>;
};

const defaultValue: BluetoothContextValue = {
  isBluetoothEnabled: true,
  scannedDevices: [],
  isScanning: false,
  startScan: () => undefined,
  connectToDevice: async () => undefined,
  connectedDevice: null,
  notifications: {},
};

const BlueContext = createContext<BluetoothContextValue>(defaultValue);

export const PreviewVideoProvider = ({children}: {children: React.ReactNode}) => {
  const [isBluetoothEnabled, setIsBluetoothEnabled] = useState(true);
  const [scannedDevices, setScannedDevices] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<any | null>(null);
  const [notifications, setNotifications] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;

    Promise.resolve((BLEService as any).requestBluetoothPermissions?.())
      .then((granted: boolean) => {
        if (mounted) {
          setIsBluetoothEnabled(granted !== false);
        }
      })
      .catch(() => {
        if (mounted) {
          setIsBluetoothEnabled(true);
        }
      });

    const statusSubscription = (BLEService as any).addStatusListener?.((data: any) => {
      const status = String(data?.status || '');

      if (status === 'scanning') {
        setIsScanning(true);
      }

      if (
        status === 'connected' ||
        status === 'ready' ||
        status === 'connected-no-notify'
      ) {
        setIsScanning(false);
        setConnectedDevice({
          id: data?.bluetoothAddress ? String(data.bluetoothAddress) : 'windows-remote',
          name: data?.deviceName || 'Bluetooth Remote',
          status,
        });
      }

      if (
        status === 'scan-stopped' ||
        status === 'scan-error' ||
        status === 'connect-failed' ||
        status === 'connect-error' ||
        status === 'disconnected' ||
        status === 'disabled'
      ) {
        setIsScanning(false);
        if (status === 'disconnected' || status === 'disabled') {
          setConnectedDevice(null);
        }
      }
    });

    const notificationSubscription = (BLEService as any).addNotificationListener?.((data: any) => {
      const key = String(data?.characteristicUUID || Date.now());
      setNotifications(prev => ({
        ...prev,
        [key]: data?.hex || data?.text || JSON.stringify(data || {}),
      }));
    });

    return () => {
      mounted = false;
      statusSubscription?.remove?.();
      notificationSubscription?.remove?.();
    };
  }, []);

  const startScan = useCallback(() => {
    setIsScanning(true);
    setScannedDevices([]);
    void (BLEService as any).scanAndConnect?.();
  }, []);

  const connectToDevice = useCallback(async (_id: string) => {
    setIsScanning(true);
    await (BLEService as any).scanAndConnect?.();
  }, []);

  const value = useMemo(
    () => ({
      isBluetoothEnabled,
      scannedDevices,
      isScanning,
      startScan,
      connectToDevice,
      connectedDevice,
      notifications,
    }),
    [
      isBluetoothEnabled,
      scannedDevices,
      isScanning,
      startScan,
      connectToDevice,
      connectedDevice,
      notifications,
    ],
  );

  return <BlueContext.Provider value={value}>{children}</BlueContext.Provider>;
};

export const useBlueContext = () => useContext(BlueContext);
