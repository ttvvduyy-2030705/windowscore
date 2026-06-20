// Cáº¥u hÃ¬nh káº¿t ná»‘i Ä‘iá»ƒm live giá»¯a app Windows vÃ  live API cá»§a web Aplus.
// Source web hiá»‡n táº¡i Ä‘ang dÃ¹ng VITE_LIVE_API_URL=https://live-api.aplusbilliards.vn/api/live
// VÃ¬ BASE_URL Ä‘Ã£ bao gá»“m /api/live nÃªn cÃ¡c endpoint bÃªn dÆ°á»›i chá»‰ báº¯t Ä‘áº§u tá»« /tournaments, /matches...

export const APLUS_LIVE_SCORE_BASE_URL = 'https://live-api.aplusbilliards.vn/api/live';

// GiÃ¡ trá»‹ nÃ y pháº£i trÃ¹ng vá»›i LIVE_SCORE_API_KEY trong file .env backend/live API.
// Náº¿u Ä‘á»ƒ sai, app sáº½ khÃ´ng táº£i Ä‘Æ°á»£c giáº£i hoáº·c bÃ¡o live API key khÃ´ng há»£p lá»‡.
export const APLUS_LIVE_SCORE_API_KEY = 'jahsd82ohehbcfjbsc89ay3wbejkhdbc982ybkejhbcf8dasjchbkjf92jdfi8ow2i';

export const APLUS_LIVE_SCORE_DEVICE_NAME = 'Windows Scoreboard';

export const APLUS_LIVE_SCORE_ENDPOINTS = {
  // GET /tournaments
  tournaments: '/tournaments',

  // GET /tournaments/:tournamentId/matches/by-code/:matchCode
  matchByCode: '/tournaments/:tournamentId/matches/by-code/:matchCode',

  // POST /matches/:matchId/claim
  claimMatch: '/matches/:matchId/claim',

  // POST /matches/:matchId/start
  startMatch: '/matches/:matchId/start',

  // PATCH /matches/:matchId/score
  updateScore: '/matches/:matchId/score',

  // POST /matches/:matchId/heartbeat
  heartbeat: '/matches/:matchId/heartbeat',

  // POST /matches/:matchId/finish
  finishMatch: '/matches/:matchId/finish',

  // POST /matches/:matchId/release
  releaseMatch: '/matches/:matchId/release',
};

