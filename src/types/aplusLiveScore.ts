export type AplusLiveMatchStatus = 'upcoming' | 'playing' | 'finished';

export type AplusLiveStreamStatus = 'offline' | 'live' | 'ended';

export type AplusTournamentOption = {
  _id: string;
  name: string;
  slug: string;
  status?: string;
  date?: string;
  location?: string;
};

export type AplusLiveMatch = {
  _id: string;
  tournament: string;
  roundName: string;
  tableNumber?: string;
  matchCode?: string;
  player1: string;
  player1City?: string;
  player1Country?: string;
  score1: string;
  player2: string;
  player2City?: string;
  player2Country?: string;
  score2: string;
  status: AplusLiveMatchStatus;
  order?: number;
  isLive?: boolean;
  liveControllerId?: string;
  liveControllerName?: string;
  liveExpiresAt?: string;
  liveLastPingAt?: string;
  livestreamUrl?: string;
  streamStatus?: AplusLiveStreamStatus;
};

export type AplusLiveTournamentLite = {
  _id: string;
  slug: string;
  name: string;
  status?: string;
};

export type AplusLiveSession = {
  matchId: string;
  tournamentId: string;
  tournamentName?: string;
  matchCode?: string;
  sessionToken: string;
  deviceId: string;
  deviceName: string;
  lockExpiresAt?: string;
};

export type AplusListTournamentsResponse = {
  tournaments: AplusTournamentOption[];
};

export type AplusFindMatchResponse = {
  match: AplusLiveMatch;
  tournament?: AplusLiveTournamentLite;
};

export type AplusClaimMatchPayload = {
  deviceId: string;
  deviceName: string;
  appVersion?: string;
};

export type AplusClaimMatchResponse = {
  match: AplusLiveMatch;
  tournament: AplusLiveTournamentLite;
  sessionToken: string;
  lockExpiresAt: string;
};

export type AplusSendScorePayload = {
  score1: number | string;
  score2: number | string;
  status?: AplusLiveMatchStatus;
  isLive?: boolean;
  livestreamUrl?: string;
  streamStatus?: AplusLiveStreamStatus;
};

export type AplusSendScoreResponse = {
  match: AplusLiveMatch;
};

export type AplusHeartbeatResponse = {
  ok: boolean;
  match: AplusLiveMatch;
};

export type AplusFinishMatchPayload = {
  score1: number | string;
  score2: number | string;
  livestreamUrl?: string;
};

export type AplusFinishMatchResponse = {
  match: AplusLiveMatch;
};

export type AplusReleaseMatchResponse = {
  ok: boolean;
  match?: AplusLiveMatch;
};

export type AplusTournamentMatchesResponse = {
  rounds: Record<string, AplusLiveMatch[]>;
  matches?: AplusLiveMatch[];
};

export type AplusLiveApiErrorShape = {
  message?: string;
  error?: string;
  liveControllerName?: string;
  lockExpiresAt?: string;
};
