// Cấu hình kết nối điểm live giữa app Windows và live API của web Aplus.
// Source web hiện tại đang dùng VITE_LIVE_API_URL=https://live-api.103.138.88.55.nip.io/api/live
// Vì BASE_URL đã bao gồm /api/live nên các endpoint bên dưới chỉ bắt đầu từ /tournaments, /matches...

export const APLUS_LIVE_SCORE_BASE_URL = 'https://live-api.103.138.88.55.nip.io/api/live';

// Giá trị này phải trùng với LIVE_SCORE_API_KEY trong file .env backend/live API.
// Nếu để sai, app sẽ không tải được giải hoặc báo live API key không hợp lệ.
export const APLUS_LIVE_SCORE_API_KEY = 'jahsd82ohehbcfjbsc89ay3wbejkhdbc982ybkejhbcf8dasjchbkjf92jdfi8ow2i';

export const APLUS_LIVE_SCORE_DEVICE_NAME = 'Windows Scoreboard';

export const APLUS_LIVE_SCORE_ENDPOINTS = {
  // GET /tournaments
  tournaments: '/tournaments',

  // GET /tournaments/:tournamentId/matches/by-code/:matchCode
  matchByCode: '/tournaments/:tournamentId/matches/by-code/:matchCode',

  // POST /matches/:matchId/claim
  claimMatch: '/matches/:matchId/claim',

  // PATCH /matches/:matchId/score
  updateScore: '/matches/:matchId/score',

  // POST /matches/:matchId/heartbeat
  heartbeat: '/matches/:matchId/heartbeat',

  // POST /matches/:matchId/finish
  finishMatch: '/matches/:matchId/finish',

  // POST /matches/:matchId/release
  releaseMatch: '/matches/:matchId/release',
};
