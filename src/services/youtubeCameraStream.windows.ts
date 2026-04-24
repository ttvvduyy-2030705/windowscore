export function isYouTubeNativeCameraEnabled() {
  return false;
}

export function addYouTubeCameraStreamListener() {
  return {
    remove: () => undefined,
  };
}

export async function startYouTubeCameraStream() {
  console.log('[Windows Live] YouTube camera stream is disabled on Windows.');
  return false;
}

export async function stopYouTubeCameraStream() {
  return false;
}

export async function updateYouTubeCameraOverlay() {
  return false;
}

export async function setYouTubeCameraZoom() {
  return 1;
}

export async function getYouTubeCameraZoomInfo() {
  return {
    supported: false,
    minZoom: 1,
    maxZoom: 1,
    zoom: 1,
    source: 'windows',
  };
}