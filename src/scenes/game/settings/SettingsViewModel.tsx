import {PLAYER_COLOR} from 'constants/player';
import {gameActions} from 'data/redux/actions/game';
import i18n from 'i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useDispatch} from 'react-redux';
import {screens} from 'scenes/screens';
import {BilliardCategory} from 'types/category';
import {Navigation} from 'types/navigation';
import {PlayerNumber, PlayerSettings} from 'types/player';
import {
  GameCountDownTime,
  GameExtraTimeBonus,
  GameExtraTimeTurns,
  GameMode,
  GameSettingsMode,
  GameWarmUpTime,
} from 'types/settings';
import {isCarom3CGame, isCaromLikeGame, isPoolGame} from 'utils/game';
import {DEFAULT_PLAYERS, GAME_SETTINGS, PLAYER_SETTINGS} from './constants';
import {GAME_EXTRA_TIME_BONUS} from 'constants/game-settings';
import {COUNTRIES, CountryItem} from './player/countries';

type LivestreamRouteParams = {
  livestreamPlatform?: 'facebook' | 'youtube' | 'tiktok' | 'device' | null;
  saveToDeviceWhileStreaming?: boolean;
  liveVisibility?: 'public' | 'private' | 'unlisted';
  liveAccountName?: string;
  liveAccountId?: string;
  liveSetupToken?: string;
};

export interface Props extends Navigation, LivestreamRouteParams {
  route?: {
    params?: LivestreamRouteParams;
  };
}

type SettingsDraftSnapshot = {
  category: BilliardCategory;
  gameSettingsMode: GameSettingsMode;
  playerSettings: PlayerSettings;
  savedAt?: number;
};

const normalizeLivestreamPlatform = (
  value?: string | null,
): 'facebook' | 'youtube' | 'tiktok' | 'device' | null => {
  if (
    value === 'facebook' ||
    value === 'youtube' ||
    value === 'tiktok' ||
    value === 'device'
  ) {
    return value;
  }

  return null;
};

const SETTINGS_DRAFT_STORAGE_KEY = '@APLUS_GAME_SETTINGS_DRAFT_V1';

const cloneSettingsValue = <T,>(value: T): T => {
  if (value == null) {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (_error) {
    return value;
  }
};

const setSettingsDraftSync = (draft: SettingsDraftSnapshot | null) => {
  (globalThis as any).__APLUS_GAME_SETTINGS_DRAFT__ = draft
    ? cloneSettingsValue(draft)
    : null;
};

const getSettingsDraftSync = (): SettingsDraftSnapshot | null => {
  const draft = (globalThis as any).__APLUS_GAME_SETTINGS_DRAFT__;
  return draft ? cloneSettingsValue(draft) : null;
};

const setSettingsDraft = async (draft: SettingsDraftSnapshot | null) => {
  const normalizedDraft = draft ? cloneSettingsValue(draft) : null;
  setSettingsDraftSync(normalizedDraft);

  try {
    if (normalizedDraft) {
      await AsyncStorage.setItem(
        SETTINGS_DRAFT_STORAGE_KEY,
        JSON.stringify(normalizedDraft),
      );
    } else {
      await AsyncStorage.removeItem(SETTINGS_DRAFT_STORAGE_KEY);
    }
  } catch (error) {
    console.log('[Game Settings] Failed to persist draft:', error);
  }
};

const getSettingsDraft = async (): Promise<SettingsDraftSnapshot | null> => {
  const runtimeDraft = getSettingsDraftSync();
  if (runtimeDraft) {
    return runtimeDraft;
  }

  try {
    const rawDraft = await AsyncStorage.getItem(SETTINGS_DRAFT_STORAGE_KEY);
    if (!rawDraft) {
      return null;
    }

    const parsedDraft = JSON.parse(rawDraft) as SettingsDraftSnapshot;
    setSettingsDraftSync(parsedDraft);
    return cloneSettingsValue(parsedDraft);
  } catch (error) {
    console.log('[Game Settings] Failed to load draft:', error);
    return null;
  }
};

const clearSettingsDraft = () => {
  setSettingsDraftSync(null);
  void setSettingsDraft(null);
};


const isRemoteUri = (value?: string) => /^https?:\/\//i.test(String(value || '').trim());

const findCountryByCode = (code?: string) => {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) {
    return undefined;
  }

  return COUNTRIES.find(item => item.code.toUpperCase() === normalizedCode);
};

const DEFAULT_COUNTRY: CountryItem =
  findCountryByCode('VN') ?? {
    code: 'VN',
    name: 'Viet Nam',
    normalizedName: 'viet nam',
    flag: 'VN',
  };

const createDefaultPlayerCountry = () => ({
  countryCode: DEFAULT_COUNTRY.code,
  countryName: DEFAULT_COUNTRY.name,
  flag: DEFAULT_COUNTRY.code,
});

const clampPlayerNumber = (value?: number): PlayerNumber => {
  const numeric = Number(value || 2);
  if (numeric >= 4) {
    return 4;
  }
  if (numeric <= 2) {
    return 2;
  }
  return 3;
};

const buildPlayersForCount = (
  playerNumber: PlayerNumber,
  category: BilliardCategory,
  previousPlayers: PlayerSettings['playingPlayers'] = [],
) => {
  return Array.from({length: playerNumber}, (_, number) => {
    const previousPlayer = previousPlayers[number];
    return {
      ...createDefaultPlayerCountry(),
      ...(previousPlayer || {}),
      name: previousPlayer?.name || i18n.t(`player${number + 1}`),
      color: isPoolGame(category)
        ? PLAYER_COLOR[1]
        : (PLAYER_COLOR as any)[number],
      totalPoint: Number(previousPlayer?.totalPoint || 0),
    };
  });
};

const sanitizePlayerSettings = (
  value: PlayerSettings,
  category: BilliardCategory = '9-ball',
): PlayerSettings => {
  const safeValue = cloneSettingsValue(value) as PlayerSettings;
  const playerNumber = clampPlayerNumber(safeValue.playerNumber);

  const normalizedPlayers = (safeValue.playingPlayers || []).map(player => {
    const fallbackCountry =
      findCountryByCode((player as any)?.countryCode) ?? DEFAULT_COUNTRY;
    const rawFlag = String((player as any)?.flag || '').trim();
    const rawCode = String((player as any)?.countryCode || '').trim().toUpperCase();
    const safeCode = /^[A-Z]{2}$/.test(rawCode)
      ? rawCode
      : fallbackCountry.code;
    const safeFlag = isRemoteUri(rawFlag) ? rawFlag : safeCode;

    return {
      ...player,
      countryCode: String(safeCode || ''),
      countryName: String(
        (player as any)?.countryName || fallbackCountry.name || '',
      ),
      flag: safeFlag,
    };
  });

  return {
    ...safeValue,
    playerNumber,
    playingPlayers: buildPlayersForCount(playerNumber, category, normalizedPlayers),
  } as PlayerSettings;
};


const GameSettingsViewModel = (props: Props) => {
  const dispatch = useDispatch();
  // withWrapper spreads route.params directly into props, so reading only
  // props.route?.params silently drops livestreamPlatform in release builds.
  // Keep the route fallback for future direct React Navigation usage.
  const routeParams = (props.route?.params || props || {}) as LivestreamRouteParams;
  const livestreamPlatform = normalizeLivestreamPlatform(
    routeParams.livestreamPlatform,
  );
  const saveToDeviceWhileStreaming = Boolean(
    routeParams.saveToDeviceWhileStreaming ?? false,
  );
  const liveVisibility = routeParams.liveVisibility || 'public';
  const liveAccountName = routeParams.liveAccountName || '';
  const liveAccountId = routeParams.liveAccountId || '';
  const liveSetupToken = routeParams.liveSetupToken || '';
  const restoredDraftRef = useRef(false);
  const runtimeDraft = getSettingsDraftSync();

  const [category, setCategory] = useState<BilliardCategory>(
    runtimeDraft?.category ?? '9-ball',
  );
  const [gameSettingsMode, setGameSettingsMode] =
    useState<GameSettingsMode>(
      runtimeDraft?.gameSettingsMode ?? GAME_SETTINGS,
    );
  const [playerSettings, setPlayerSettings] = useState<PlayerSettings>(
    runtimeDraft?.playerSettings
      ? sanitizePlayerSettings(runtimeDraft.playerSettings, runtimeDraft?.category ?? '9-ball')
      : PLAYER_SETTINGS(),
  );

  const _resetData = useCallback(() => {
    clearSettingsDraft();

    const timeout = setTimeout(() => {
      setCategory('9-ball');
      setGameSettingsMode(GAME_SETTINGS);
      setPlayerSettings(PLAYER_SETTINGS());
      clearTimeout(timeout);
    }, 100);
  }, []);


  useEffect(() => {
    let cancelled = false;

    if (runtimeDraft) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const persistedDraft = await getSettingsDraft();

      if (cancelled || !persistedDraft || restoredDraftRef.current) {
        return;
      }

      restoredDraftRef.current = true;
      setCategory(persistedDraft.category);
      setGameSettingsMode(persistedDraft.gameSettingsMode);
      setPlayerSettings(sanitizePlayerSettings(persistedDraft.playerSettings, persistedDraft.category));
    })();

    return () => {
      cancelled = true;
    };
  }, [runtimeDraft]);


  useEffect(() => {
    const nextPlayerNumber = clampPlayerNumber(playerSettings.playerNumber);
    const needsClamp =
      nextPlayerNumber !== playerSettings.playerNumber ||
      (playerSettings.playingPlayers?.length || 0) !== nextPlayerNumber;

    if (!needsClamp) {
      return;
    }

    setPlayerSettings(prev =>
      ({
        ...prev,
        playerNumber: nextPlayerNumber,
        playingPlayers: buildPlayersForCount(
          nextPlayerNumber,
          category,
          prev.playingPlayers,
        ),
      } as PlayerSettings),
    );
  }, [category, playerSettings.playerNumber, playerSettings.playingPlayers]);

  useEffect(() => {
    const draft: SettingsDraftSnapshot = {
      category,
      gameSettingsMode: cloneSettingsValue(gameSettingsMode),
      playerSettings: cloneSettingsValue(playerSettings),
      savedAt: Date.now(),
    };

    setSettingsDraftSync(draft);

    const timeout = setTimeout(() => {
      void setSettingsDraft(draft);
    }, 250);

    return () => {
      clearTimeout(timeout);
    };
  }, [category, gameSettingsMode, playerSettings]);

  const onCancel = useCallback(() => {
    clearSettingsDraft();
    props.goBack();
  }, [props]);

  const onStart = useCallback(() => {
    const _playingPlayers = playerSettings.playingPlayers.map(player => {
      return {
        ...player,
        proMode: {
          ...gameSettingsMode,
          highestRate: 0,
          secondHighestRate: 0,
          average: 0,
          currentPoint: 0,
        },
      };
    });

    clearSettingsDraft();

    const shouldCreateYouTubeLive = livestreamPlatform === 'youtube';

    console.log('[Live Flow] start pressed', {
      selectedPlatform: livestreamPlatform,
      youtubeConnected: Boolean(liveAccountName || liveAccountId || liveSetupToken),
      shouldCreateYouTubeLive,
      saveToDeviceWhileStreaming,
      liveVisibility,
    });

    if (!shouldCreateYouTubeLive) {
      console.log('[Live Flow] local recording active reason=selectedPlatform is not youtube', {
        selectedPlatform: livestreamPlatform,
      });
    }

    const nextGameSettings = {
      category,
      mode: gameSettingsMode,
      players: {...playerSettings, playingPlayers: _playingPlayers},
      livestreamPlatform,
      saveToDeviceWhileStreaming,
      liveVisibility,
      liveAccountName,
      liveAccountId,
      liveSetupToken,
    };

    dispatch(gameActions.updateGameSettings(nextGameSettings));

    // Also pass the live params directly to gameplay. The Redux update is saga-based
    // and can arrive after the gameplay screen mounts; route params are available
    // immediately and prevent the YouTube flow from falling back to local recording.
    props.navigate(screens.gamePlay, {
      gameSettings: nextGameSettings,
      livestreamPlatform,
      saveToDeviceWhileStreaming,
      liveVisibility,
      liveAccountName,
      liveAccountId,
      liveSetupToken,
    });

    _resetData();
  }, [
    dispatch,
    _resetData,
    props,
    category,
    gameSettingsMode,
    playerSettings,
    livestreamPlatform,
    saveToDeviceWhileStreaming,
    liveVisibility,
    liveAccountName,
    liveAccountId,
    liveSetupToken,
  ]);

  const onSelectCategory = useCallback(
  (selectedCategory: BilliardCategory) => {
    const isCaromLike = isCaromLikeGame(selectedCategory);
    const isThreeCushion = isCarom3CGame(selectedCategory);
    const defaultGoal = isPoolGame(selectedCategory)
      ? 9
      : isThreeCushion
      ? 30
      : selectedCategory === 'libre'
      ? 40
      : 40;

    setCategory(selectedCategory);

    setPlayerSettings({
      playerNumber: 2,
      playingPlayers: DEFAULT_PLAYERS().map((item, index) => ({
        ...item,
        color: isPoolGame(selectedCategory)
          ? PLAYER_COLOR[1]
          : (PLAYER_COLOR as any)[index],
      })),
      goal: {
        ...playerSettings.goal,
        goal: defaultGoal,
      },
    });

    if (isCaromLike) {
      setGameSettingsMode({
        mode: 'pro',
        extraTimeTurns: 2,
        countdownTime: 40,
        warmUpTime: 300,
      });
    } else if (isPoolGame(selectedCategory)) {
      setGameSettingsMode({
        mode: 'pro',
        extraTimeTurns: 1,
        countdownTime: 35,
        warmUpTime: 300,
        extraTimeBonus: GAME_EXTRA_TIME_BONUS.s0,
      });
    } else {
      setGameSettingsMode({
        mode: 'fast',
      });
    }
  },
  [playerSettings],
);

const onSelectGameMode = useCallback(
  (selectedGameMode: GameMode) => {
    const isCaromLike = isCaromLikeGame(category);

    switch (selectedGameMode) {
      case 'fast':
        setGameSettingsMode({mode: selectedGameMode});
        break;

      case 'time':
        setGameSettingsMode({
          mode: selectedGameMode,
          extraTimeTurns: isCaromLike ? 2 : 1,
          countdownTime: isCaromLike ? 40 : 35,
        });
        break;

      case 'eliminate':
        setGameSettingsMode({
          mode: selectedGameMode,
          countdownTime: isCaromLike ? 40 : 35,
        });
        break;

      case 'pro':
        setGameSettingsMode({
          mode: selectedGameMode,
          extraTimeTurns: isCaromLike ? 2 : 1,
          countdownTime: isCaromLike ? 40 : 35,
          warmUpTime: 300,
          extraTimeBonus: isPoolGame(category)
            ? GAME_EXTRA_TIME_BONUS.s0
            : undefined,
        });
        break;

      default:
        break;
    }
  },
  [category],
);

  const onSelectExtraTimeBonus = useCallback(
    (extraTimeBonus: GameExtraTimeBonus) => {
      setGameSettingsMode({
        ...gameSettingsMode,
        extraTimeBonus,
      } as GameSettingsMode);
    },
    [gameSettingsMode],
  );

  const onSelectExtraTimeTurns = useCallback(
    (extraTimeTurns: GameExtraTimeTurns) => {
      setGameSettingsMode({
        ...gameSettingsMode,
        extraTimeTurns,
      } as GameSettingsMode);
    },
    [gameSettingsMode],
  );

  const onSelectCountdown = useCallback(
    (countdownTime: GameCountDownTime) => {
      setGameSettingsMode({
        ...gameSettingsMode,
        countdownTime,
      } as GameSettingsMode);
    },
    [gameSettingsMode],
  );

  const onSelectWarmUp = useCallback(
    (warmUpTime: GameWarmUpTime) => {
      setGameSettingsMode({
        ...gameSettingsMode,
        warmUpTime,
      } as GameSettingsMode);
    },
    [gameSettingsMode],
  );

  const onSelectPlayerNumber = useCallback(
    (playerNumber: PlayerNumber) => {
      const nextPlayerNumber = clampPlayerNumber(playerNumber);
      setPlayerSettings({
        ...playerSettings,
        playerNumber: nextPlayerNumber,
        playingPlayers: buildPlayersForCount(
          nextPlayerNumber,
          category,
          playerSettings.playingPlayers,
        ),
      } as PlayerSettings);
    },
    [playerSettings, category],
  );

  const onChangePlayerPoint = useCallback(
    (addedPoint: number, index: number, stepIndex: number) => {
      if (stepIndex === 4) {
        return;
      }

      setPlayerSettings(
        prev =>
          ({
            ...prev,
            playingPlayers: prev.playingPlayers.map((player, playerIndex) => {
              if (index === playerIndex) {
                return {...player, totalPoint: player.totalPoint + addedPoint};
              }

              return player;
            }),
          } as PlayerSettings),
      );
    },
    [],
  );

  const onChangePlayerName = useCallback((newName: string, index: number) => {
    setPlayerSettings(
      prev =>
        ({
          ...prev,
          playingPlayers: prev.playingPlayers.map((player, playerIndex) => {
            if (index === playerIndex) {
              return {...player, name: newName};
            }

            return player;
          }),
        } as PlayerSettings),
    );
  }, []);


  const onSelectPlayerCountry = useCallback((country: CountryItem, index: number) => {
    setPlayerSettings(
      prev =>
        ({
          ...prev,
          playingPlayers: prev.playingPlayers.map((player, playerIndex) => {
            if (index === playerIndex) {
              return {
                ...player,
                countryCode: country.code,
                countryName: country.name,
                flag: country.code,
              };
            }

            return player;
          }),
        } as PlayerSettings),
    );
  }, []);

  const onSelectPlayerGoal = useCallback(
    (addedPoint: number, index: number) => {
      if (index === 2) {
        return;
      }

      setPlayerSettings(
        prev =>
          ({
            ...prev,
            goal: {
              ...prev.goal,
              goal: prev.goal.goal + addedPoint,
            },
          } as PlayerSettings),
      );
    },
    [],
  );

  return useMemo(() => {
    const gameMode = gameSettingsMode.mode;
    return {
      category,
      gameMode,
      gameSettingsMode,
      playerSettings,
      extraTimeTurnsEnabled: gameMode === 'time' || gameMode === 'pro',
      countdownEnabled: gameMode !== 'fast',
      warmUpEnabled: gameMode === 'pro',
      extraTimeBonusEnabled: gameMode === 'pro' && isPoolGame(category),
      onSelectExtraTimeBonus,
      onSelectCategory,
      onSelectGameMode,
      onSelectExtraTimeTurns,
      onSelectCountdown,
      onSelectWarmUp,
      onSelectPlayerNumber,
      onSelectPlayerGoal,
      onChangePlayerName,
      onChangePlayerPoint,
      onSelectPlayerCountry,
      onStart,
      onCancel,
    };
  }, [
    category,
    gameSettingsMode,
    playerSettings,
    onSelectCategory,
    onSelectGameMode,
    onSelectExtraTimeBonus,
    onSelectExtraTimeTurns,
    onSelectCountdown,
    onSelectWarmUp,
    onSelectPlayerNumber,
    onSelectPlayerGoal,
    onChangePlayerName,
    onChangePlayerPoint,
    onSelectPlayerCountry,
    onStart,
    onCancel,
  ]);
};

export default GameSettingsViewModel;
