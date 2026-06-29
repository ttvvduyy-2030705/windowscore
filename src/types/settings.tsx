import {BilliardCategory} from './category';
import {PlayerSettings} from './player';

export type GameMode = 'fast' | 'quick_match' | 'time' | 'eliminate' | 'pro';
export type GameModePool = 'fast' | 'time';
export type GameExtraTimeTurns = 1 | 2 | 3 | 4 | 'infinity';
export type GameCountDownTime = 30 | 35 | 40 | 45 | 50 | 55 | 60;
export type GameWarmUpTime = 60 | 120 | 180 | 300 | 600 | 900 | undefined;
export type GameExtraTimeBonus = 0 | 10 | 20 | 30 | 45;

export type GameSettingsMode = {
  mode: GameMode;
  extraTimeTurns?: GameExtraTimeTurns;
  countdownTime?: GameCountDownTime;
  warmUpTime?: GameWarmUpTime;
  extraTimeBonus?: GameExtraTimeBonus;
};

export type GameSettings = {
  createdAt?: Date;
  updatedAt?: Date;
  totalTime?: number;
  category: BilliardCategory;
  mode: GameSettingsMode;
  players: PlayerSettings;
  webcamFolderName?: string;
};
