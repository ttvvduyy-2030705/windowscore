import type {BufferConfig} from 'react-native-video';
import {SelectedVideoTrackType} from 'react-native-video';

const WEBCAM_HOST = 'rtsp://';
const WEBCAM_PORT = '554';
// const WEBCAM_PATH = '/cam/realmonitor?channel=1&subtype=1';
const WEBCAM_PATH = '/cam/realmonitor?channel=1&subtype=0';

const SELECTED_VIDEO_TRACK_INDEX =
  (SelectedVideoTrackType as any)?.INDEX ?? 'index';

const WEBCAM_SELECTED_VIDEO_TRACK = {
  type: SELECTED_VIDEO_TRACK_INDEX,
  value: 0,
};

const WEBCAM_BUFFER_CONFIG: BufferConfig = {
  minBufferMs: 15000,
  maxBufferMs: 50000,
  bufferForPlaybackMs: 2500,
  bufferForPlaybackAfterRebufferMs: 5000,
  backBufferDurationMs: 120000,
  cacheSizeMB: 0,
  live: {
    targetOffsetMs: 500,
  },
};

const WEBCAM_BASE_FILE_NAME = 'webcam_';
const WEBCAM_FILE_EXTENSION = '.mov';

const WEBCAM_BASE_CAMERA_FOLDER = 'camera';
const WEBCAM_OUTPUT_FILE_NAME = 'output_camera';
const WEBCAM_OUTPUT_TEMP_FILE_NAME = 'output_temp_camera';
const CAMERA_FILE_EXTENSION = '.ts';

const MATCH_IMAGE = 'match_info.png';
const MATCH_COUNTDOWN = 'match_countdown.png';

const LIVESTREAM_IMAGE_TOP_LEFT = 'image_top_left.png';
const LIVESTREAM_IMAGE_TOP_RIGHT = 'image_top_right.png';
const LIVESTREAM_IMAGE_BOTTOM_LEFT = 'image_bottom_left.png';
const LIVESTREAM_IMAGE_BOTTOM_RIGHT = 'image_bottom_right.png';

export {
  WEBCAM_HOST,
  WEBCAM_PORT,
  WEBCAM_PATH,
  WEBCAM_BUFFER_CONFIG,
  WEBCAM_SELECTED_VIDEO_TRACK,
  WEBCAM_BASE_FILE_NAME,
  WEBCAM_OUTPUT_TEMP_FILE_NAME,
  WEBCAM_BASE_CAMERA_FOLDER,
  WEBCAM_OUTPUT_FILE_NAME,
  WEBCAM_FILE_EXTENSION,
  CAMERA_FILE_EXTENSION,
  MATCH_IMAGE,
  MATCH_COUNTDOWN,
  LIVESTREAM_IMAGE_TOP_LEFT,
  LIVESTREAM_IMAGE_TOP_RIGHT,
  LIVESTREAM_IMAGE_BOTTOM_LEFT,
  LIVESTREAM_IMAGE_BOTTOM_RIGHT,
};
