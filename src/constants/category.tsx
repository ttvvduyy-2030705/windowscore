import {Carom, Libre, Pool, Snooker} from 'types/category';

type CUSHION_TYPE = 'ONE_CUSHION' | 'THREE_CUSHION';
type LIBRE_TYPE = 'LIBRE';
type POOL_TYPE =
  | 'NINE_BALL'
  | 'TEN_BALL'
  | 'FIFTEEN_BALL'
  | 'FIFTEEN_FREE_BALL';
type SNOOKER_TYPE = 'SNOOKER';

const CUSHION: {[key in CUSHION_TYPE]: Carom} = {
  ONE_CUSHION: 'one-cushion',
  THREE_CUSHION: 'three-cusion',
};
const LIBRE: {[key in LIBRE_TYPE]: Libre} = {
  LIBRE: 'libre',
};
const POOL: {[key in POOL_TYPE]: Pool} = {
  NINE_BALL: '9-ball',
  TEN_BALL: '10-ball',
  FIFTEEN_BALL: '15-ball',
  FIFTEEN_FREE_BALL: '15-free-ball',
};
const SNOOKER: {[key in SNOOKER_TYPE]: Snooker} = {
  SNOOKER: 'snooker',
};

export {CUSHION, LIBRE, POOL, SNOOKER};
