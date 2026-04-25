const DeviceInfo = {
  getBundleId: () => 'billiardsgrade.windows',
  getVersion: () => '1.0.0',
  getBuildNumber: () => '1',
  getApplicationName: () => 'APlus Score Windows',
  getDeviceName: async () => 'Windows PC',
  getSystemName: () => 'Windows',
  getSystemVersion: () => '10',
  getUniqueId: async () => 'windows-device',
  getFreeDiskStorage: async () => 100 * 1024 * 1024 * 1024,
  getTotalDiskCapacity: async () => 256 * 1024 * 1024 * 1024,
  getUsedMemory: async () => 0,
  isTablet: () => false,
  hasNotch: () => false,
};

export default DeviceInfo;