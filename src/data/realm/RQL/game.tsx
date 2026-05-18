import Realm, {BSON} from 'realm';
import {GameSchema} from '../models/game';
import {GameExtraTimeTurns, GameSettings} from 'types/settings';
import {PlayerSettings} from 'types/player';
import {useQuery} from '@realm/react';


const toSafeInteger = (value: unknown, fallback = 0): number => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.round(numericValue);
};

const sanitizePlayerSettingsForRealm = (
  playerSettings?: PlayerSettings,
): PlayerSettings | undefined => {
  if (!playerSettings) {
    return playerSettings;
  }

  return {
    ...playerSettings,
    goal: playerSettings.goal
      ? {
          ...playerSettings.goal,
          goal: toSafeInteger(playerSettings.goal.goal, 0),
          pointSteps: Array.isArray(playerSettings.goal.pointSteps)
            ? playerSettings.goal.pointSteps.map(step => toSafeInteger(step, 0) as any)
            : [],
        }
      : playerSettings.goal,
    playingPlayers: Array.isArray(playerSettings.playingPlayers)
      ? playerSettings.playingPlayers.map(player => ({
          ...player,
          totalPoint: toSafeInteger(player.totalPoint, 0),
          violate:
            player.violate == null
              ? player.violate
              : toSafeInteger(player.violate, 0),
          scoredBalls: Array.isArray(player.scoredBalls)
            ? player.scoredBalls.map(ball => ({
                ...ball,
                number:
                  (ball as any)?.number == null
                    ? (ball as any)?.number
                    : String((ball as any).number) as any,
              }))
            : player.scoredBalls,
          proMode: player.proMode
            ? {
                ...player.proMode,
                highestRate:
                  player.proMode.highestRate == null
                    ? player.proMode.highestRate
                    : toSafeInteger(player.proMode.highestRate, 0),
                secondHighestRate:
                  (player.proMode as any).secondHighestRate == null
                    ? (player.proMode as any).secondHighestRate
                    : toSafeInteger((player.proMode as any).secondHighestRate, 0),
                average:
                  player.proMode.average == null
                    ? player.proMode.average
                    : toSafeInteger(player.proMode.average, 0),
                currentPoint:
                  player.proMode.currentPoint == null
                    ? player.proMode.currentPoint
                    : toSafeInteger(player.proMode.currentPoint, 0),
                extraTimeTurns:
                  player.proMode.extraTimeTurns == null
                    ? player.proMode.extraTimeTurns
                    : toSafeInteger(player.proMode.extraTimeTurns, 0) as any,
              }
            : player.proMode,
        }))
      : [],
  };
};

const sanitizeGameSettingsForRealm = (gameSettings: GameSettings): GameSettings => {
  return {
    ...gameSettings,
    totalTime: toSafeInteger(gameSettings.totalTime, 0),
    mode: {
      ...gameSettings.mode,
      countdownTime:
        gameSettings.mode?.countdownTime == null
          ? gameSettings.mode?.countdownTime
          : toSafeInteger(gameSettings.mode.countdownTime, 0),
      warmUpTime:
        gameSettings.mode?.warmUpTime == null
          ? gameSettings.mode?.warmUpTime
          : toSafeInteger(gameSettings.mode.warmUpTime, 0),
      extraTimeTurns:
        gameSettings.mode?.extraTimeTurns == null
          ? gameSettings.mode?.extraTimeTurns
          : (toSafeInteger(gameSettings.mode.extraTimeTurns, 0).toString() as GameExtraTimeTurns),
    },
    players: sanitizePlayerSettingsForRealm(gameSettings.players) as PlayerSettings,
  };
};


const CreateGame = (realm: Realm, gameSettings: GameSettings) => {
  const sanitizedGameSettings = sanitizeGameSettingsForRealm(gameSettings);

  realm.write(() => {
    const now = new Date();
    const id = new BSON.ObjectId();

    realm.create(GameSchema, {
      id,
      createdAt: now,
      updatedAt: now,
      totalTime: sanitizedGameSettings.totalTime || 0,
      category: sanitizedGameSettings.category,
      mode: {
        ...sanitizedGameSettings.mode,
        extraTimeTurns:
          sanitizedGameSettings.mode.extraTimeTurns?.toString() as GameExtraTimeTurns,
      },
      players: sanitizedGameSettings.players,
      webcamFolderName: sanitizedGameSettings.webcamFolderName,
    });
  });
};

const ReadGames = (params?: {
  length?: number;
}): (GameSettings & {
  id: BSON.ObjectId;
  createdAt: Date;
  updatedAt: Date;
})[] => {
  // const games = useQuery(GameSchema);

  const games = useQuery(
    GameSchema,
    gamesQuery => {
      return gamesQuery.sorted('updatedAt', true);
    },
    [],
  );

  return games.slice(0, params?.length || 20).map(
    game =>
      ({
        id: game.id,
        createdAt: game.createdAt,
        updatedAt: game.updatedAt,
        totalTime: game.totalTime,
        category: game.category,
        mode: game.mode,
        players: game.players,
        webcamFolderName: game.webcamFolderName,
      } as GameSettings & {
        id: BSON.ObjectId;
        createdAt: Date;
        updatedAt: Date;
      }),
  );
};

const UpdateGame = (
  realm: Realm,
  id: BSON.ObjectId,
  gameSettings: GameSettings,
) => {
  const toUpdate = realm.objects(GameSchema).filtered('id == $0', id);
  const sanitizedGameSettings = sanitizeGameSettingsForRealm(gameSettings);

  const now = new Date();
  realm.write(() => {
    toUpdate[0].updatedAt = now;
    toUpdate[0].category = sanitizedGameSettings.category;
    toUpdate[0].mode = sanitizedGameSettings.mode;
    toUpdate[0].players = sanitizedGameSettings.players;
  });
};

const DeleteGame = (realm: Realm, id: BSON.ObjectId) => {
  const toDelete = realm.objects(GameSchema).filtered('id == $0', id);

  realm.write(() => {
    realm.delete(toDelete);
  });
};

export {CreateGame, ReadGames, UpdateGame, DeleteGame};
