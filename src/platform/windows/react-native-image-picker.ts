type ImagePickerResponse = {
  didCancel?: boolean;
  errorCode?: string;
  errorMessage?: string;
  assets?: any[];
};

const cancelledResponse: ImagePickerResponse = {
  didCancel: true,
  assets: [],
};

const resolve = async (callback?: (response: ImagePickerResponse) => void) => {
  callback?.(cancelledResponse);
  return cancelledResponse;
};

export const launchImageLibrary = async (
  _options?: any,
  callback?: (response: ImagePickerResponse) => void,
) => {
  console.log('[Windows ImagePicker] launchImageLibrary disabled');
  return resolve(callback);
};

export const launchCamera = async (
  _options?: any,
  callback?: (response: ImagePickerResponse) => void,
) => {
  console.log('[Windows ImagePicker] launchCamera disabled');
  return resolve(callback);
};

export default {
  launchImageLibrary,
  launchCamera,
};
