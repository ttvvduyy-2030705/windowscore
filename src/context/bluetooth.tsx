import React, {createContext, useContext, useMemo} from 'react';

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
  isBluetoothEnabled: false,
  scannedDevices: [],
  isScanning: false,
  startScan: () => undefined,
  connectToDevice: async () => undefined,
  connectedDevice: null,
  notifications: {},
};

const BlueContext = createContext<BluetoothContextValue>(defaultValue);

export const PreviewVideoProvider = ({children}: {children: React.ReactNode}) => {
  const value = useMemo(() => defaultValue, []);
  return <BlueContext.Provider value={value}>{children}</BlueContext.Provider>;
};

export const useBlueContext = () => useContext(BlueContext);
