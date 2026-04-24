export type UsbDeviceInfo = {
  deviceId?: number;
  vendorId?: number;
  productId?: number;
  name?: string;
};

export async function listUsbDevices(): Promise<UsbDeviceInfo[]> {
  return [];
}

export async function startUvcRecording() {
  throw new Error('UVC recording is Android-only in this Windows build.');
}

export async function stopUvcRecording() {
  return null;
}

export async function setUvcZoom() {
  return 1;
}

export async function getUvcZoomInfo() {
  return {
    supported: false,
    minZoom: 1,
    maxZoom: 1,
    zoom: 1,
    source: 'windows',
  };
}