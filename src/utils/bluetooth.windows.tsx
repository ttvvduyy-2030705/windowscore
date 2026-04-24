const BluetoothWindows = {
  isPermissionsGranted: false,

  requestBluetoothPermissions: async () => false,

  scanAndConnect: async () => undefined,

  disconnect: async () => undefined,

  destroy: () => undefined,
};

export default BluetoothWindows;
export const BLEService = BluetoothWindows;
