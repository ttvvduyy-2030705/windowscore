import {PLAYER_COLOR} from 'constants/player';
import {gameActions} from 'data/redux/actions/game';
import i18n from 'i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useDispatch} from 'react-redux';
import {screens} from 'scenes/screens';
import {BilliardCategory} from 'types/category';
import {Navigation} from 'types/navigation';
import {Player, PlayerNumber, PlayerSettings} from 'types/player';
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
import {
  AplusLiveScoreError,
  createAplusLiveSessionFromClaim,
  fetchAplusLiveTournaments,
  findAplusLiveMatchByCode,
  claimAplusLiveMatch,
  getAplusLiveDeviceName,
  getOrCreateAplusLiveDeviceId,
} from 'services/aplusLiveScore';
import type {AplusLiveMatch, AplusTournamentOption} from 'types/aplusLiveScore';

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

export type AplusLiveConnectStatus =
  | 'idle'
  | 'loading'
  | 'checking'
  | 'claiming'
  | 'ready'
  | 'error';

export type AplusLiveSettingsPanelState = {
  tournaments: AplusTournamentOption[];
  selectedTournamentId: string;
  matchCodeInput: string;
  connectStatus: AplusLiveConnectStatus;
  connectError: string;
  connectMessage: string;
  previewMatch?: AplusLiveMatch;
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


const normalizeWebCountryCode = (value?: string) => {
  const cleanValue = String(value || '').trim().toUpperCase();

  if (/^[A-Z]{2}$/.test(cleanValue)) {
    return cleanValue;
  }

  return DEFAULT_COUNTRY.code;
};

const buildAplusLivePlayer = (
  basePlayer: Player,
  options: {
    name?: string;
    countryCode?: string;
    score?: string | number;
  },
): Player => {
  const countryCode = normalizeWebCountryCode(options.countryCode);
  const country = findCountryByCode(countryCode) ?? DEFAULT_COUNTRY;
  const numericScore = Number(options.score ?? 0);

  return {
    ...basePlayer,
    name: String(options.name || basePlayer.name || '').trim(),
    totalPoint: Number.isFinite(numericScore) ? numericScore : 0,
    countryCode: country.code,
    countryName: country.name,
    flag: country.code,
  };
};

const hasAplusLiveConnectionInput = (
  tournamentId: string,
  matchCode: string,
) => Boolean(tournamentId || String(matchCode || '').trim());


const formatAplusMatchScore = (match?: AplusLiveMatch) => {
  const score1 = String(match?.score1 ?? '0').trim() || '0';
  const score2 = String(match?.score2 ?? '0').trim() || '0';
  return `${score1} - ${score2}`;
};

const buildAplusFinishedMatchMessage = (match: AplusLiveMatch) => {
  const matchCode = match.matchCode ? ` ${match.matchCode}` : '';
  const players = match.player1 && match.player2 ? ` (${match.player1} vs ${match.player2})` : '';
  return `Trận${matchCode}${players} đã kết thúc rồi, tỉ số là ${formatAplusMatchScore(match)}.`;
};

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

  const [aplusLiveTournaments, setAplusLiveTournaments] = useState<
    AplusTournamentOption[]
  >([]);
  const [selectedAplusTournamentId, setSelectedAplusTournamentId] = useState('');
  const [aplusMatchCodeInput, setAplusMatchCodeInput] = useState('');
  const [aplusLiveConnectStatus, setAplusLiveConnectStatus] =
    useState<AplusLiveConnectStatus>('idle');
  const [aplusLiveConnectError, setAplusLiveConnectError] = useState('');
  const [aplusLiveConnectMessage, setAplusLiveConnectMessage] = useState('');
  const [aplusPreviewMatch, setAplusPreviewMatch] = useState<
    AplusLiveMatch | undefined
  >();

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

  const isAplusLivePanelAvailable =
    gameSettingsMode.mode === 'pro' && playerSettings.playerNumber === 2;

  const loadAplusLiveTournaments = useCallback(async () => {
    setAplusLiveConnectStatus('loading');
    setAplusLiveConnectError('');
    setAplusLiveConnectMessage('');

    try {
      const tournaments = await fetchAplusLiveTournaments();
      setAplusLiveTournaments(tournaments);

      setSelectedAplusTournamentId(prev => {
        if (prev && tournaments.some(item => item._id === prev)) {
          return prev;
        }

        return tournaments[0]?._id || '';
      });

      setAplusLiveConnectStatus('idle');
      setAplusLiveConnectMessage(
        tournaments.length
          ? `Đã tải ${tournaments.length} giải từ Aplus.`
          : 'Chưa có giải nào từ Aplus.',
      );
    } catch (error: any) {
      setAplusLiveConnectStatus('error');
      setAplusLiveConnectError(
        error?.message || 'Không tải được danh sách giải Aplus.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isAplusLivePanelAvailable) {
      setAplusLiveConnectStatus('idle');
      setAplusLiveConnectError('');
      setAplusLiveConnectMessage('');
      setAplusPreviewMatch(undefined);
      return;
    }

    if (!aplusLiveTournaments.length) {
      void loadAplusLiveTournaments();
    }
  }, [
    aplusLiveTournaments.length,
    isAplusLivePanelAvailable,
    loadAplusLiveTournaments,
  ]);

  const onSelectAplusTournament = useCallback((tournamentId: string) => {
    setSelectedAplusTournamentId(tournamentId);
    setAplusPreviewMatch(undefined);
    setAplusLiveConnectError('');
    setAplusLiveConnectMessage('');
  }, []);

  const normalizeAplusMatchCode = useCallback((matchCode: string) => {
    const rawCode = String(matchCode || '').toUpperCase().replace(/[^T0-9]/g, '');

    if (!rawCode) {
      return '';
    }

    const hasLeadingT = rawCode.startsWith('T');
    const digits = rawCode.replace(/T/g, '').replace(/\D/g, '').slice(0, 3);

    if (hasLeadingT && !digits) {
      return 'T';
    }

    return digits ? `T${digits}` : '';
  }, []);

  const onChangeAplusMatchCode = useCallback((matchCode: string) => {
    const normalizedCode = normalizeAplusMatchCode(matchCode);
    setAplusMatchCodeInput(normalizedCode);
    setAplusPreviewMatch(undefined);
    setAplusLiveConnectError('');
    setAplusLiveConnectMessage('');
  }, [normalizeAplusMatchCode]);

  const onCheckAplusLiveMatch = useCallback(async () => {
    if (!isAplusLivePanelAvailable) {
      setAplusLiveConnectStatus('error');
      setAplusLiveConnectError('Kết nối web chỉ dùng cho chế độ Thi đấu và 2 người chơi.');
      return;
    }

    if (!/^T\d{1,3}$/.test(aplusMatchCodeInput)) {
      setAplusLiveConnectStatus('error');
      setAplusLiveConnectError('Mã trận phải có dạng T + số, ví dụ T01.');
      return;
    }

    if (!selectedAplusTournamentId) {
      setAplusLiveConnectStatus('error');
      setAplusLiveConnectError('Bạn cần bấm Tải lại và chọn giải trước khi kiểm tra mã trận.');
      return;
    }

    setAplusLiveConnectStatus('checking');
    setAplusLiveConnectError('');
    setAplusLiveConnectMessage('');
    setAplusPreviewMatch(undefined);

    try {
      const result = await findAplusLiveMatchByCode(
        selectedAplusTournamentId,
        aplusMatchCodeInput,
      );

      setAplusPreviewMatch(result.match);

      if (result.match.status === 'finished') {
        setAplusLiveConnectStatus('error');
        setAplusLiveConnectError(buildAplusFinishedMatchMessage(result.match));
        return;
      }

      setAplusLiveConnectStatus('ready');
      setAplusLiveConnectMessage(
        `Đã tìm thấy trận ${result.match.matchCode || aplusMatchCodeInput}: ${
          result.match.player1
        } vs ${result.match.player2}`,
      );
    } catch (error: any) {
      setAplusLiveConnectStatus('error');
      setAplusLiveConnectError(
        error instanceof AplusLiveScoreError
          ? error.message
          : error?.message || 'Không tìm thấy trận Aplus.',
      );
    }
  }, [
    aplusMatchCodeInput,
    isAplusLivePanelAvailable,
    selectedAplusTournamentId,
  ]);

  const onCancel = useCallback(() => {
    clearSettingsDraft();
    props.goBack();
  }, [props]);

  const onStart = useCallback(async () => {
    const shouldUseAplusLive = Boolean(
      isAplusLivePanelAvailable &&
        hasAplusLiveConnectionInput(
          selectedAplusTournamentId,
          aplusMatchCodeInput,
        ),
    );

    let claimedMatch: AplusLiveMatch | undefined;
    let aplusLiveSession: any;

    if (shouldUseAplusLive) {
      if (!selectedAplusTournamentId) {
        setAplusLiveConnectStatus('error');
        setAplusLiveConnectError('Bạn cần chọn giải trước khi bắt đầu trận.');
        return;
      }

      if (!/^T\d{1,3}$/.test(aplusMatchCodeInput)) {
        setAplusLiveConnectStatus('error');
        setAplusLiveConnectError('Mã trận phải có dạng T + số, ví dụ T01.');
        return;
      }

      setAplusLiveConnectStatus('claiming');
      setAplusLiveConnectError('');
      setAplusLiveConnectMessage('Đang khóa trận trên web Aplus...');

      try {
        const matchResult = await findAplusLiveMatchByCode(
          selectedAplusTournamentId,
          aplusMatchCodeInput,
        );
        const match = matchResult.match;

        if (!match?.player1 || !match?.player2) {
          setAplusLiveConnectStatus('error');
          setAplusLiveConnectError(
            'Trận này chưa đủ thông tin 2 cơ thủ trên web. Hãy nhập cơ thủ ở admin web trước.',
          );
          return;
        }

        if (match.status === 'finished') {
          setAplusLiveConnectStatus('error');
          setAplusPreviewMatch(match);
          setAplusLiveConnectError(buildAplusFinishedMatchMessage(match));
          return;
        }

        const deviceId = await getOrCreateAplusLiveDeviceId();
        const deviceName = await getAplusLiveDeviceName();
        const claim = await claimAplusLiveMatch(match._id, {
          deviceId,
          deviceName,
          appVersion: 'windows-scoreboard-v1',
        });

        claimedMatch = claim.match;
        aplusLiveSession = await createAplusLiveSessionFromClaim(
          claim,
          deviceId,
          deviceName,
        );

        setAplusPreviewMatch(claim.match);
        setAplusLiveConnectStatus('ready');
        setAplusLiveConnectMessage(
          `Đã khóa trận ${claim.match.matchCode || aplusMatchCodeInput}: ${
            claim.match.player1
          } vs ${claim.match.player2}`,
        );
      } catch (error: any) {
        setAplusLiveConnectStatus('error');
        setAplusLiveConnectError(
          error instanceof AplusLiveScoreError
            ? error.message
            : error?.message || 'Không claim được trận Aplus.',
        );
        return;
      }
    }

    const sourcePlayers = playerSettings.playingPlayers;
    const playingPlayers = sourcePlayers.map((player, index) => {
      const basePlayer = {
        ...player,
        proMode: {
          ...gameSettingsMode,
          highestRate: 0,
          secondHighestRate: 0,
          average: 0,
          currentPoint: 0,
        },
      } as Player;

      if (!claimedMatch) {
        return basePlayer;
      }

      if (index === 0) {
        return buildAplusLivePlayer(basePlayer, {
          name: claimedMatch.player1,
          countryCode: claimedMatch.player1Country,
          score: claimedMatch.score1,
        });
      }

      if (index === 1) {
        return buildAplusLivePlayer(basePlayer, {
          name: claimedMatch.player2,
          countryCode: claimedMatch.player2Country,
          score: claimedMatch.score2,
        });
      }

      return basePlayer;
    });

    clearSettingsDraft();

    const shouldCreateYouTubeLive = livestreamPlatform === 'youtube';

    console.log('[Live Flow] start pressed', {
      selectedPlatform: livestreamPlatform,
      youtubeConnected: Boolean(liveAccountName || liveAccountId || liveSetupToken),
      shouldCreateYouTubeLive,
      saveToDeviceWhileStreaming,
      liveVisibility,
      aplusLiveEnabled: Boolean(aplusLiveSession),
    });

    if (!shouldCreateYouTubeLive) {
      console.log('[Live Flow] local recording active reason=selectedPlatform is not youtube', {
        selectedPlatform: livestreamPlatform,
      });
    }

    const nextPlayerSettings = {
      ...playerSettings,
      playerNumber: claimedMatch ? 2 : playerSettings.playerNumber,
      playingPlayers,
    } as PlayerSettings;

    const nextGameSettings = {
      category,
      mode: gameSettingsMode,
      players: nextPlayerSettings,
      livestreamPlatform,
      saveToDeviceWhileStreaming,
      liveVisibility,
      liveAccountName,
      liveAccountId,
      liveSetupToken,
      aplusLiveSession,
      aplusLiveMatch: claimedMatch,
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
      aplusLiveSession,
      aplusLiveMatch: claimedMatch,
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
    isAplusLivePanelAvailable,
    selectedAplusTournamentId,
    aplusMatchCodeInput,
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
      aplusLivePanel: {
        tournaments: aplusLiveTournaments,
        selectedTournamentId: selectedAplusTournamentId,
        matchCodeInput: aplusMatchCodeInput,
        connectStatus: aplusLiveConnectStatus,
        connectError: aplusLiveConnectError,
        connectMessage: aplusLiveConnectMessage,
        previewMatch: aplusPreviewMatch,
      } as AplusLiveSettingsPanelState,
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
      onRefreshAplusTournaments: loadAplusLiveTournaments,
      onSelectAplusTournament,
      onChangeAplusMatchCode,
      onCheckAplusLiveMatch,
      onStart,
      onCancel,
    };
  }, [
    category,
    gameSettingsMode,
    playerSettings,
    aplusLiveTournaments,
    selectedAplusTournamentId,
    aplusMatchCodeInput,
    aplusLiveConnectStatus,
    aplusLiveConnectError,
    aplusLiveConnectMessage,
    aplusPreviewMatch,
    loadAplusLiveTournaments,
    onSelectAplusTournament,
    onChangeAplusMatchCode,
    onCheckAplusLiveMatch,
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
