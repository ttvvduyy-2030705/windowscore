import Realm, {ObjectSchema} from 'realm';
import {
  Player,
  PlayerGoal,
  PlayerPointStep,
  PlayerProMode,
  PlayerSettings,
} from 'types/player';
import {PoolBallType} from 'types/ball';

export class PlayerGoalSchema extends Realm.Object<PlayerGoal> {
  // _id!: BSON.ObjectId;
  goal!: number;
  pointSteps!: PlayerPointStep[];

  static schema: ObjectSchema = {
    name: 'PlayerGoal',
    properties: {
      // _id: 'objectId',
      goal: 'int',
      pointSteps: 'int[]',
    },
    // primaryKey: '_id',
  };
}
export class PlayerProModeSchema extends Realm.Object<PlayerProMode> {
  // _id!: BSON.ObjectId;
  highestRate?: number;
  secondHighestRate?: number;
  average?: number;
  currentPoint?: number;
  extraTimeTurns?: number | string;

  static schema: ObjectSchema = {
    name: 'PlayerProMode',
    properties: {
      // _id: 'objectId',
      highestRate: 'int?',
      secondHighestRate: 'int?',
      average: 'int?',
      currentPoint: 'int?',
      extraTimeTurns: 'int?',
    },
    // primaryKey: '_id',
  };
}

export class PlayerSchema extends Realm.Object<Player> {
  // _id!: BSON.ObjectId;
  name!: string;
  color!: string;
  totalPoint!: number;
  proMode?: PlayerProMode;
  violate?: number;
  scoredBalls?: PoolBallType[];

  static schema: ObjectSchema = {
    name: 'Player',
    properties: {
      // _id: 'objectId',
      name: 'string',
      color: 'string',
      totalPoint: 'int',
      proMode: {type: 'object', objectType: 'PlayerProMode', optional: true},
      violate: 'int?',
      scoredBalls: {type: 'list', objectType: 'PoolBall'},
    },
    // primaryKey: '_id',
  };
}

export class PlayerSettingsSchema extends Realm.Object<PlayerSettings> {
  // _id!: BSON.ObjectId;
  playerNumber!: number;
  playingPlayers!: Player[];
  goal!: PlayerGoal;
  proModeEnabled?: boolean;

  static schema: ObjectSchema = {
    name: 'PlayerSettings',
    properties: {
      // _id: 'objectId',
      playerNumber: 'int',
      playingPlayers: {type: 'list', objectType: 'Player'},
      goal: {type: 'object', objectType: 'PlayerGoal'},
      proModeEnabled: 'bool?',
    },
    // primaryKey: '_id',
  };
}
