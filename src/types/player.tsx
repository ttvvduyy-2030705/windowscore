import {PoolBallType} from './ball';
import {GameExtraTimeTurns} from './settings';

export type PlayerPointStep = -10 | -50 | -1 | -5 | 0 | 1 | 5 | 10 | 50;

export type PlayerNumber = 2 | 3 | 4;

export type PlayerGoal = {
  goal: number;
  pointSteps: PlayerPointStep[];
};

export type PlayerProMode = {
  highestRate: number;
  secondHighestRate?: number;
  average: number;
  currentPoint: number;
  extraTimeTurns: GameExtraTimeTurns;
};

export type Player = {
  name: string;
  color: string;
  totalPoint: number;
  countryCode?: string;
  countryName?: string;
  flag?: string;
  proMode?: PlayerProMode;
  violate?: number;
  scoredBalls?: PoolBallType[];
};

export type PlayerSettings = {
  playerNumber: PlayerNumber;
  playingPlayers: Player[];
  goal: PlayerGoal;
  proModeEnabled?: boolean;
};
