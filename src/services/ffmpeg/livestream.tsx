import {LiveStreamCamera, WebcamType} from 'types/webcam';
import {BilliardCategory} from 'types/category';

const liveStreamFromCamera = async (
  liveStream?: LiveStreamCamera,
  webcamUrl?: string,
  webcamType?: WebcamType,
  countdownEnabled?: boolean,
  category?: BilliardCategory,
) => {
  console.log('[WindowsOnly] legacy mobile liveStreamFromCamera skipped', {
    hasLiveStreamConfig: Boolean(liveStream),
    hasWebcamUrl: Boolean(webcamUrl),
    webcamType,
    countdownEnabled,
    category,
  });

  return undefined;
};

export {liveStreamFromCamera};
