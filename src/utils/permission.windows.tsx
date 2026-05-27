export const requestCameraPermission = async () => true;

export const checkCameraPermission = async () => true;

export const requestMicrophonePermission = async () => true;

export const checkMicrophonePermission = async () => true;

export const requestBluetoothPermissions = async () => true;

export const checkBluetoothPermissions = async () => true;

// Windows app writes match videos under the user's Videos folder via native/FS code.
// Android requires READ/WRITE_EXTERNAL_STORAGE, but Windows does not need the
// Android permission request. Keep the same exported function name so shared
// webcam/gameplay code can call it safely on Windows.
export const requestReadWriteStorage = async () => true;

export const checkReadWriteStorage = async () => true;

export default {
  requestCameraPermission,
  checkCameraPermission,
  requestMicrophonePermission,
  checkMicrophonePermission,
  requestBluetoothPermissions,
  checkBluetoothPermissions,
  requestReadWriteStorage,
  checkReadWriteStorage,
};
