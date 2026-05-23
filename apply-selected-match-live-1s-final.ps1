$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$gp = Join-Path $root 'src\scenes\game\game-play\GamePlayViewModel.tsx'
$idx = Join-Path $root 'src\scenes\game\game-play\console\index.tsx'
$sync = Join-Path $root 'src\scenes\game\game-play\console\AplusWebLiveCountdownSync.tsx'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function ReadUtf8($path) {
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function WriteUtf8($path, $text) {
  [System.IO.File]::WriteAllText($path, $text, $script:utf8)
}

if (!(Test-Path $gp)) { throw "Missing file: $gp" }
if (!(Test-Path $idx)) { throw "Missing file: $idx" }

Copy-Item $gp "$gp.bak-selected-live-final-$stamp" -Force
Copy-Item $idx "$idx.bak-selected-live-final-$stamp" -Force
Write-Host "Backups created."

# 1) Remove the hidden countdown sync component from console/index.tsx.
$lines = [System.Collections.Generic.List[string]]::new()
[System.IO.File]::ReadAllLines($idx, [System.Text.Encoding]::UTF8) | ForEach-Object { [void]$lines.Add($_) }
$out = [System.Collections.Generic.List[string]]::new()
$skip = $false
for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  if ($line -match 'import\s+AplusWebLiveCountdownSync\s+from') {
    continue
  }
  if ($line.Contains('<AplusWebLiveCountdownSync')) {
    $skip = $true
    if ($line.Contains('/>')) { $skip = $false }
    continue
  }
  if ($skip) {
    if ($line.Contains('/>')) { $skip = $false }
    continue
  }
  [void]$out.Add($line)
}
WriteUtf8 $idx ([string]::Join([Environment]::NewLine, $out) + [Environment]::NewLine)
Write-Host "Removed hidden AplusWebLiveCountdownSync from console/index.tsx."

if (Test-Path $sync) {
  $disabled = "$sync.disabled-selected-live-final-$stamp"
  Move-Item $sync $disabled -Force
  Write-Host "Disabled hidden sync file: $disabled"
}

# 2) Move or install the selected-match 1s live sync effect after buildAplusLiveRealtimePayload.
$text = ReadUtf8 $gp

$effectStartMarker = '  // Aplus live realtime meta/countdown sync every second.'
$effectEndMarker = '  const finishAplusLiveSessionSafely = useCallback('
$effectStart = $text.IndexOf($effectStartMarker)
if ($effectStart -ge 0) {
  $effectEnd = $text.IndexOf($effectEndMarker, $effectStart)
  if ($effectEnd -lt 0) { throw 'Could not find end marker after old realtime sync effect.' }
  $text = $text.Remove($effectStart, $effectEnd - $effectStart)
  Write-Host "Removed old misplaced realtime sync effect."
}

$buildMarker = '  const buildAplusLiveRealtimePayload = useCallback(() => {'
if ($text.IndexOf($buildMarker) -lt 0) {
  throw 'buildAplusLiveRealtimePayload was not found in GamePlayViewModel.tsx.'
}

$newEffect = @'

  // SELECTED_MATCH_REALTIME_1S_SYNC_FINAL
  // Push score, turn count, target score and countdown once per second.
  // It uses only the selected/claimed match session from the existing Aplus panel.
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
        console.log('[AplusLiveScore] selected-match realtime 1s sync failed', message);
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

# Insert after the helper block, before soundEnabled state.
$soundMarker = '  const [soundEnabled, setSoundEnabled] = useState(true);'
$soundPos = $text.IndexOf($soundMarker)
if ($soundPos -lt 0) { throw 'Could not find insertion marker: soundEnabled.' }
if ($text.IndexOf('SELECTED_MATCH_REALTIME_1S_SYNC_FINAL') -lt 0) {
  $text = $text.Insert($soundPos, $newEffect + [Environment]::NewLine)
  Write-Host "Inserted selected-match 1s sync effect after realtime payload helper."
} else {
  Write-Host "Selected-match 1s sync effect already exists."
}

WriteUtf8 $gp $text
Write-Host "Updated GamePlayViewModel.tsx."

Write-Host "Done. Now close the Windows app, then run: npm run windows"
