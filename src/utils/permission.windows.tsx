export const requestReadWriteStorage = async () => true;

export const requestReadWriteStoragePermission = async () => true;

export const requestStoragePermission = async () => true;

export const requestCameraPermission = async () => true;

export const requestMicrophonePermission = async () => true;

export const requestBluetoothPermissions = async () => false;

export const checkBluetoothPermissions = async () => false;

const PermissionWindows = {
  requestReadWriteStorage,
  requestReadWriteStoragePermission,
  requestStoragePermission,
  requestCameraPermission,
  requestMicrophonePermission,
  requestBluetoothPermissions,
  checkBluetoothPermissions,
};

export default PermissionWindows;