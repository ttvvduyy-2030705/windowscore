export enum OutputType {
  local = 'local',
  livestream = 'livestream',
}

export enum Resolution {
  HD = '0.75',
  FullHD = '1',
  QHD = '1,33333333',
}

export enum Fps {
  F30 = '30',
  F60 = '60',
}

export enum Bitrate {
  B5000 = '5000k',
  B9000 = '9000k',
}

export type WebcamFile = {
  id: number;
  name: string;
  path: string;
};

export type Webcam = {
  webcamIP: string;
  username: string;
  password: string;
  syncTime: number;
  scale?: number;
  translateX?: number;
  translateY?: number;
  outputType: OutputType;
};

export type LiveStreamCamera = {
  username?: string;
  rtmpUrl: string;
  streamKey: string;
  outputType: OutputType;
  resolution: Resolution;
  fps: Fps;
  bitrate: Bitrate;
  ffmpegPath?: string;
  cameraDeviceName?: string;
  audioDeviceName?: string;
  useAudio?: boolean;
  localLiveMode?: 'ffmpeg-local' | 'oauth-backend';
};

export enum WebcamType {
  INDEX = 'index',
  webcam = 'webcam',
  camera = 'camera',
  phone = 'camera',
  external = 'webcam',
}

export type YouTubeItem = {
  kind: string;
  etag: string;
  id: string;
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    isDefaultStream: boolean;
  };
  status: {
    streamStatus: string;
    healthStatus: {
      status: string;
    };
  };
  contentDetails: {
    closedCaptionsIngestionUrl: string;
    isReusable: boolean;
  };
};

export type YouTubeResponse = {
  etag: string;
  items: YouTubeItem[];
  kind: string;
  pageInfo: {resultsPerPage: number; totalResults: number};
};