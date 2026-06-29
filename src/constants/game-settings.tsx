import {
  GameCountDownTime,
  GameExtraTimeBonus,
  GameExtraTimeTurns,
  GameMode,
  GameModePool,
  GameWarmUpTime,
} from 'types/settings';

type GAME_MODE_TYPE = 'FAST' | 'QUICK_MATCH' | 'PRO';
type GAME_MODE_POOL_TYPE = 'FAST' | 'TIME';
type GAME_EXTRA_TIME_TURN_TYPE = 't1' | 't2' | 't3' | 't4' | 'infinity';
type GAME_COUNT_DOWN_TIME_TYPE =
  | 's30'
  | 's35'
  | 's40'
  | 's45'
  | 's50'
  | 's55'
  | 's60';
type GAME_WARM_UP_TIME_TYPE =
  | 'p1'
  | 'p2'
  | 'p3'
  | 'p5'
  | 'p10'
  | 'p15'
  | 'undefined';

type GAME_EXTRA_TIME_BONUS_TYPE = 's0' | 's10' | 's20' | 's30' | 's45';

const GAME_EXTRA_TIME_BONUS: {
  [key in GAME_EXTRA_TIME_BONUS_TYPE]: GameExtraTimeBonus;
} = {
  s0: 0,
  s10: 10,
  s20: 20,
  s30: 30,
  s45: 45,
};

const GAME_MODE: {[key in GAME_MODE_TYPE]: GameMode} = {
  FAST: 'fast',
  QUICK_MATCH: 'quick_match',
  PRO: 'pro',
};

const GAME_MODE_POOL: {[key in GAME_MODE_POOL_TYPE]: GameModePool} = {
  FAST: 'fast',
  TIME: 'time',
};

const GAME_EXTRA_TIME_TURN: {
  [key in GAME_EXTRA_TIME_TURN_TYPE]: GameExtraTimeTurns;
} = {
  t1: 1,
  t2: 2,
  t3: 3,
  t4: 4,
  infinity: 'infinity',
};

const GAME_COUNT_DOWN_TIME: {
  [key in GAME_COUNT_DOWN_TIME_TYPE]: GameCountDownTime;
} = {
  s30: 30,
  s35: 35,
  s40: 40,
  s45: 45,
  s50: 50,
  s55: 55,
  s60: 60,
};

const GAME_WARM_UP_TIME: {[key in GAME_WARM_UP_TIME_TYPE]: GameWarmUpTime} = {
  p1: 60,
  p2: 120,
  p3: 180,
  p5: 300,
  p10: 600,
  p15: 900,
  undefined: undefined,
};

export {
  GAME_MODE,
  GAME_MODE_POOL,
  GAME_EXTRA_TIME_TURN,
  GAME_COUNT_DOWN_TIME,
  GAME_WARM_UP_TIME,
  GAME_EXTRA_TIME_BONUS,
};
