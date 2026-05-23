# Fix Aplus live match meta sync every 1 second
# Run from your Windows app root: C:\project\windowscore
$ErrorActionPreference = 'Stop'

$file = Join-Path (Get-Location) 'src\scenes\game\game-play\GamePlayViewModel.tsx'
if (!(Test-Path $file)) {
  throw "Cannot find GamePlayViewModel.tsx at: $file. Please run this script from C:\project\windowscore"
}

$backup = "$file.bak-aplus-live-meta-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $file $backup -Force
Write-Host "Backup created: $backup"

$text = Get-Content $file -Raw

if ($text -notmatch 'buildAplusLiveRealtimePayload') {
  $anchor = "  const [poolBreakEnabled, setPoolBreakEnabled] = useState<boolean>(false);"
  if ($text.IndexOf($anchor) -lt 0) {
    throw "Cannot find poolBreakEnabled state anchor. No changes made."
  }

  $helper = @'
  const buildAplusLiveRealtimePayload = useCallback(() => {
    const countdownSeconds = Math.max(0, Math.round(Number(countdownTime || 0)));
    const baseCountdownRaw =
      (gameSettings as any)?.mode?.countdownTime ??
      (gameSettings as any)?.countdownTime ??
      countdownSeconds;
    const countdownBase = Math.max(
      countdownSeconds,
      Math.round(Number(baseCountdownRaw || countdownSeconds || 0)),
    );
    const turnCount = Math.max(
      1,
      Math.round(Number(totalTurnsRef.current || totalTurns || 1)),
    );
    const targetRaw =
      (gameSettings as any)?.players?.goal?.goal ??
      (gameSettings as any)?.goal?.goal ??
      (gameSettings as any)?.goal ??
      (playerSettingsRef.current as any)?.goal?.goal ??
      (playerSettingsRef.current as any)?.goal ??
      (playerSettingsRef.current as any)?.targetScore ??
      0;
    const targetScore = Math.round(Number(targetRaw || 0));
    const countdownRunning = Boolean(
      isStarted &&
        !isPaused &&
        !isMatchPaused &&
        !poolBreakEnabled &&
        !winnerRef.current,
    );

    return {
      liveCountdownTime: countdownSeconds,
      liveCountdownBaseTime: countdownBase,
      liveCountdownIsRunning: countdownRunning,
      liveCountdownStatus: winnerRef.current
        ? 'finished'
        : countdownRunning
          ? 'running'
          : 'paused',
      targetScore: targetScore > 0 ? targetScore : undefined,
      liveTargetScore: targetScore > 0 ? targetScore : undefined,
      turnCount,
      liveTurnCount: turnCount,
    };
  }, [
    countdownTime,
    gameSettings,
    isMatchPaused,
    isPaused,
    isStarted,
    poolBreakEnabled,
    totalTurns,
  ]);

'@
  $text = $text.Replace($anchor, "$anchor`r`n$helper")
  Write-Host "Inserted buildAplusLiveRealtimePayload helper."
} else {
  Write-Host "Helper already exists, skipped insertion."
}

# Add realtime meta into the main pending score payload
$oldPayload = @'
      const payload = {
        score1: pendingScore.score1,
        score2: pendingScore.score2,
        status: pendingScore.status,
        isLive: pendingScore.isLive,
        ...(pendingScore.livestreamUrl !== undefined
          ? {livestreamUrl: pendingScore.livestreamUrl}
          : {}),
        ...(pendingScore.streamStatus ? {streamStatus: pendingScore.streamStatus} : {}),
      };
'@
$newPayload = @'
      const payload = {
        score1: pendingScore.score1,
        score2: pendingScore.score2,
        status: pendingScore.status,
        isLive: pendingScore.isLive,
        ...buildAplusLiveRealtimePayload(),
        ...(pendingScore.livestreamUrl !== undefined
          ? {livestreamUrl: pendingScore.livestreamUrl}
          : {}),
        ...(pendingScore.streamStatus ? {streamStatus: pendingScore.streamStatus} : {}),
      } as any;
'@
if ($text.Contains($oldPayload)) {
  $text = $text.Replace($oldPayload, $newPayload)
  Write-Host "Patched main pending score payload."
} elseif ($text -match '\.\.\.buildAplusLiveRealtimePayload\(\)') {
  Write-Host "Main payload already seems patched."
} else {
  Write-Warning "Could not patch main payload automatically. You may need to add ...buildAplusLiveRealtimePayload() into the payload manually."
}

# Add realtime meta into livestream publish payload, if this flow is used
$oldStream = @'
          streamStatus: 'live',
        });
'@
$newStream = @'
          streamStatus: 'live',
          ...buildAplusLiveRealtimePayload(),
        } as any);
'@
if ($text.Contains($oldStream) -and $text -notmatch "streamStatus: 'live',[\s\S]{0,120}buildAplusLiveRealtimePayload") {
  $text = $text.Replace($oldStream, $newStream)
  Write-Host "Patched livestream publish payload."
}

# Add a 1-second meta sync loop so turns/countdown update without score changes
if ($text -notmatch 'realtime meta/countdown sync every second') {
  $anchor2 = "  const finishAplusLiveSessionSafely = useCallback("
  if ($text.IndexOf($anchor2) -lt 0) {
    throw "Cannot find finishAplusLiveSessionSafely anchor. Main payload may be patched, but 1s loop was not inserted."
  }

  $effect = @'
  // Aplus live realtime meta/countdown sync every second.
  // This keeps turn count, target score and countdown moving even when the score does not change.
  useEffect(() => {
    if (!isStarted) {
      return;
    }

    const timer = setInterval(() => {
      const session = aplusLiveSessionRef.current;
      const latestPlayerSettings = playerSettingsRef.current || playerSettings;

      if (!session?.matchId || !session?.sessionToken || !latestPlayerSettings) {
        return;
      }

      const {score1, score2} = getAplusLiveCurrentScores(latestPlayerSettings);

      void sendAplusLiveScore(
        session.matchId,
        session.sessionToken,
        {
          score1,
          score2,
          status: winnerRef.current ? 'finished' : 'playing',
          isLive: true,
          ...buildAplusLiveRealtimePayload(),
        } as any,
      ).catch((error: any) => {
        const message = getAplusLiveErrorMessage(error);
        console.log('[AplusLiveScore] realtime meta sync failed', message);
      });
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [
    buildAplusLiveRealtimePayload,
    getAplusLiveCurrentScores,
    isStarted,
    playerSettings,
  ]);

'@
  $text = $text.Replace($anchor2, "$effect$anchor2")
  Write-Host "Inserted 1-second realtime meta sync loop."
} else {
  Write-Host "1-second realtime meta sync loop already exists, skipped insertion."
}

Set-Content $file $text -Encoding UTF8
Write-Host "Done. Now close the Windows app and run: npm run windows"
