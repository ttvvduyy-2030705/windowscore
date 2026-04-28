import {useRealm} from '@realm/react';
import {ReadGames} from 'data/realm/RQL/game';
import {historyActions} from 'data/redux/actions/history';
import i18n from 'i18n';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, Platform} from 'react-native';
import {useDispatch} from 'react-redux';
import {screens} from 'scenes/screens';
import {GameSettings} from 'types/settings';
import {navigate} from 'utils/navigation';
import {
  deleteReplayFolder,
  listHistoryMatches,
  listPlayableFiles,
} from 'services/replay/localReplay';

type HistoryGameItem = GameSettings & {
  id?: any;
  createdAt: Date;
  updatedAt: Date;
  isScannedHistoryOnly?: boolean;
};

const FALLBACK_PLAYER_COLORS = ['#D82027', '#007AFF', '#34C759', '#FF9500'];

const buildFallbackPlayers = (
  playerNames?: string[],
  finalScore?: number[],
  finalPlayers?: any[],
) => {
  if (Array.isArray(finalPlayers) && finalPlayers.length > 0) {
    return {
      playerNumber: Math.max(2, finalPlayers.length),
      goal: {
        goal: 0,
        pointSteps: [],
      },
      playingPlayers: finalPlayers.map((player, index) => ({
        ...(player || {}),
        name: player?.name || playerNames?.[index] || `Player ${index + 1}`,
        color: player?.color || FALLBACK_PLAYER_COLORS[index % FALLBACK_PLAYER_COLORS.length],
        totalPoint: Number(
          player?.totalPoint ?? player?.point ?? finalScore?.[index] ?? 0,
        ),
        scoredBalls: Array.isArray(player?.scoredBalls) ? player.scoredBalls : [],
      })),
    };
  }

  const names = playerNames?.filter(Boolean)?.length
    ? playerNames.filter(Boolean)
    : ['Player 1', 'Player 2'];

  return {
    playerNumber: Math.max(2, names.length),
    goal: {
      goal: 0,
      pointSteps: [],
    },
    playingPlayers: names.map((name, index) => ({
      name,
      color: FALLBACK_PLAYER_COLORS[index % FALLBACK_PLAYER_COLORS.length],
      totalPoint: Number(finalScore?.[index] ?? 0),
      scoredBalls: [],
    })),
  };
};

const buildScannedHistoryGame = (entry: any): HistoryGameItem => {
  const manifest = entry?.manifest;
  const totalDurationSeconds = Array.isArray(manifest?.segments)
    ? manifest.segments.reduce(
        (sum: number, segment: any) => sum + Number(segment?.durationSeconds || 0),
        0,
      )
    : 0;

  return {
    createdAt: new Date(entry?.createdAt || Date.now()),
    updatedAt: new Date(entry?.updatedAt || Date.now()),
    totalTime: Math.round(Number(manifest?.durationMs || 0) / 1000 || totalDurationSeconds || 0),
    category: (manifest?.mode as any) || ('libre' as any),
    mode: {
      mode: 'time',
      countdownTime: 0,
    } as any,
    players: buildFallbackPlayers(
      manifest?.playerNames,
      manifest?.finalScore,
      manifest?.finalPlayers,
    ) as any,
    webcamFolderName: entry?.webcamFolderName,
    isScannedHistoryOnly: true,
  } as HistoryGameItem;
};

const HistoryViewModel = () => {
  const realm = useRealm();
  const games = ReadGames() as HistoryGameItem[];
  const dispatch = useDispatch();
  const [scannedHistoryGames, setScannedHistoryGames] = useState<HistoryGameItem[]>([]);

  const refreshScannedHistory = useCallback(async () => {
    if (Platform.OS !== 'windows') {
      setScannedHistoryGames([]);
      return;
    }

    try {
      const matches = await listHistoryMatches();
      setScannedHistoryGames(matches.map(buildScannedHistoryGame));
    } catch (error) {
      console.log('[HistoryScreen] scan failed', error);
      setScannedHistoryGames([]);
    }
  }, []);

  useEffect(() => {
    refreshScannedHistory();
  }, [refreshScannedHistory]);

  const combinedGames = useMemo(() => {
    const realmGames = games || [];
    const knownWebcamFolders = new Set(
      realmGames.map(game => String(game.webcamFolderName || '')).filter(Boolean),
    );

    const scannedOnly = scannedHistoryGames.filter(game => {
      const webcamFolderName = String(game.webcamFolderName || '');
      return webcamFolderName.length > 0 && !knownWebcamFolders.has(webcamFolderName);
    });

    return [...realmGames, ...scannedOnly].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [games, scannedHistoryGames]);

  const buildCategoryTitle = useCallback((game: GameSettings) => {
    return i18n.t(`${game?.category}`).toUpperCase();
  }, []);

  const buildModeTitle = useCallback((game: GameSettings) => {
    return i18n.t(`${game?.mode?.mode}`).toUpperCase();
  }, []);

  const onReWatchGame = useCallback(async (webcamFolderName?: string) => {
    if (!webcamFolderName) {
      Alert.alert(i18n.t('txtError'), i18n.t('msgEmptyWebcamUrl'));
      return;
    }

    const files = await listPlayableFiles(webcamFolderName, true);

    console.log('[HistoryScreen]', {
      selectedWebcamFolderName: webcamFolderName,
      finalListCount: files.length,
    });

    for (const file of files) {
      console.log('[HistoryScreen]', {
        itemPath: file.path,
        exists: true,
        size: Number(file.size || 0),
      });
    }

    const selectedFile = files[0];
    if (selectedFile) {
      console.log('[HistoryScreen]', {
        selectedPath: selectedFile.path,
        selectedExists: true,
        selectedSize: Number(selectedFile.size || 0),
        selectedSource: 'HistoryOnly',
      });
    }

    if (!files.length) {
      Alert.alert(i18n.t('txtError'), i18n.t('msgWebcamVideoNotExist'));
      return;
    }

    navigate(screens.playback, {webcamFolderName, merged: false});
  }, []);

  const onDeleteGame = useCallback(
    (item: HistoryGameItem) => {
      Alert.alert(
        i18n.t('stop'),
        i18n.t('msgConfirmAction', {
          action: i18n.t('txtRemove'),
          name: i18n.t('txtHistory'),
        }),
        [
          {
            text: i18n.t('txtCancel'),
            style: 'cancel',
          },
          {
            text: i18n.t('txtRemove'),
            onPress: async () => {
              if (item.isScannedHistoryOnly || !item.id) {
                await deleteReplayFolder(item.webcamFolderName, {includeArchive: true});
                await refreshScannedHistory();
                return;
              }

              dispatch(historyActions.deleteHistory({realm, item}));
            },
          },
        ],
      );
    },
    [realm, dispatch, refreshScannedHistory],
  );

  return useMemo(() => {
    return {
      games: combinedGames,
      buildModeTitle,
      buildCategoryTitle,
      onReWatchGame,
      onDeleteGame,
    };
  }, [combinedGames, buildModeTitle, buildCategoryTitle, onReWatchGame, onDeleteGame]);
};

export default HistoryViewModel;
