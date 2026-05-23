// APLUS_SELECTED_MATCH_LIVE_SYNC_FINAL_PATCH
// Run from C:\project\windowscore with: node .\apply-aplus-selected-live-sync-final.cjs
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const tsxPath = path.join(root, 'src', 'scenes', 'game', 'game-play', 'GamePlayViewModel.tsx');
const indexPath = path.join(root, 'src', 'scenes', 'game', 'game-play', 'console', 'index.tsx');
const hiddenSyncPath = path.join(root, 'src', 'scenes', 'game', 'game-play', 'console', 'AplusWebLiveCountdownSync.tsx');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

function mustRead(file) {
  if (!fs.existsSync(file)) {
    throw new Error('Missing file: ' + file);
  }
  return fs.readFileSync(file, 'utf8');
}

function backup(file, tag) {
  if (fs.existsSync(file)) {
    const bak = file + '.bak-' + tag + '-' + stamp;
    fs.copyFileSync(file, bak);
    console.log('Backup:', bak);
  }
}

function removeBetween(text, startNeedle, endNeedle) {
  let changed = false;
  while (true) {
    const start = text.indexOf(startNeedle);
    if (start < 0) break;
    const end = text.indexOf(endNeedle, start + startNeedle.length);
    if (end < 0) break;
    text = text.slice(0, start) + text.slice(end);
    changed = true;
  }
  return { text, changed };
}

function removeJsxSelfClosingBlocks(text, tagName) {
  let changed = false;
  while (true) {
    const start = text.indexOf('<' + tagName);
    if (start < 0) break;
    const end = text.indexOf('/>', start);
    if (end < 0) break;
    let blockStart = start;
    while (blockStart > 0 && text[blockStart - 1] !== '\n') blockStart--;
    let blockEnd = end + 2;
    while (blockEnd < text.length && (text[blockEnd] === ' ' || text[blockEnd] === '\t' || text[blockEnd] === '\r' || text[blockEnd] === '\n')) blockEnd++;
    text = text.slice(0, blockStart) + text.slice(blockEnd);
    changed = true;
  }
  return { text, changed };
}

const syncBlock = `
  // SELECTED_MATCH_REALTIME_1S_SYNC_FINAL
  // Sends the currently selected Aplus live match to the web every second.
  // This uses only aplusLiveSession from the Aplus panel, so it cannot jump to another matchCode by itself.
  useEffect(() => {
    let cancelled = false;
    let sending = false;

    const syncSelectedMatchLiveScore = async () => {
      if (cancelled || sending) {
        return;
      }

      const session = aplusLiveSessionRef.current;
      const latestPlayerSettings = playerSettingsRef.current || playerSettings;

      if (
        !session?.matchId ||
        !session?.sessionToken ||
        !latestPlayerSettings ||
        aplusLiveFinishedRef.current
      ) {
        return;
      }

      sending = true;

      try {
        const {score1, score2} = getAplusLiveCurrentScores(latestPlayerSettings);
        const livestreamUrl = aplusLiveStreamUrlRef.current;

        await sendAplusLiveScore(
          session.matchId,
          session.sessionToken,
          {
            score1,
            score2,
            status: winnerRef.current ? 'finished' : 'playing',
            isLive: true,
            ...(livestreamUrl
              ? {livestreamUrl, streamStatus: 'live' as const}
              : {}),
            ...buildAplusLiveRealtimePayload(),
          } as any,
        );

        if (!cancelled) {
          setAplusLiveSyncStatus('online');
          setAplusLiveSyncError('');
        }
      } catch (error: any) {
        const message = getAplusLiveErrorMessage(error);
        console.log('[AplusLiveScore] selected match 1s sync failed', message);
        if (!cancelled) {
          setAplusLiveSyncStatus('error');
          setAplusLiveSyncError(message);
        }
      } finally {
        sending = false;
      }
    };

    void syncSelectedMatchLiveScore();
    const timer = setInterval(syncSelectedMatchLiveScore, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    aplusLiveSession?.matchId,
    aplusLiveSession?.sessionToken,
    buildAplusLiveRealtimePayload,
    getAplusLiveCurrentScores,
  ]);
`;

// Patch GamePlayViewModel.tsx
let gpv = mustRead(tsxPath);
backup(tsxPath, 'selected-live-final');

let r;
r = removeBetween(gpv, '\n  // Aplus live realtime meta/countdown sync every second.', '\n  const finishAplusLiveSessionSafely');
gpv = r.text + (r.changed ? '' : '');
if (r.changed) console.log('Removed old Aplus realtime block before finish callback.');

r = removeBetween(gpv, '\n  // SELECTED_MATCH_REALTIME_1S_SYNC_FINAL', '\n  const [soundEnabled, setSoundEnabled]');
gpv = r.text;
if (r.changed) console.log('Removed old SELECTED_MATCH realtime block before sound state.');

r = removeBetween(gpv, '\n  // SELECTED_MATCH_REALTIME_1S_SYNC_FINAL', '\n  const finishAplusLiveSessionSafely');
gpv = r.text;
if (r.changed) console.log('Removed old SELECTED_MATCH realtime block before finish callback.');

const soundAnchor = '\n  const [soundEnabled, setSoundEnabled] = useState(true);';
if (!gpv.includes('const buildAplusLiveRealtimePayload = useCallback')) {
  throw new Error('buildAplusLiveRealtimePayload is missing. Restore the previous GamePlayViewModel first.');
}
if (!gpv.includes(soundAnchor)) {
  throw new Error('Could not find soundEnabled anchor. The file layout is different than expected.');
}

gpv = gpv.replace(soundAnchor, syncBlock + soundAnchor);
fs.writeFileSync(tsxPath, gpv, 'utf8');
console.log('Patched GamePlayViewModel selected-match 1s sync.');

// Patch console/index.tsx to remove the hidden sync component
if (fs.existsSync(indexPath)) {
  let idx = mustRead(indexPath);
  backup(indexPath, 'remove-hidden-aplus-sync');
  const before = idx;
  idx = idx
    .split(/\r?\n/)
    .filter(line => !line.includes('AplusWebLiveCountdownSync'))
    .join('\n');
  const removed = removeJsxSelfClosingBlocks(idx, 'AplusWebLiveCountdownSync');
  idx = removed.text;
  if (idx !== before) {
    fs.writeFileSync(indexPath, idx, 'utf8');
    console.log('Removed hidden AplusWebLiveCountdownSync import/mount from console/index.tsx.');
  } else {
    console.log('No hidden AplusWebLiveCountdownSync import/mount found in console/index.tsx.');
  }
}

// Disable hidden sync file so it cannot be imported accidentally later
if (fs.existsSync(hiddenSyncPath)) {
  const disabled = hiddenSyncPath + '.disabled-selected-match-final-' + stamp;
  fs.renameSync(hiddenSyncPath, disabled);
  console.log('Disabled hidden sync file:', disabled);
}

console.log('DONE. Close the Windows app completely, then run: npm run windows');
console.log('Verify with: Get-ChildItem .\\src -Recurse -Include *.ts,*.tsx | Select-String "AplusWebLiveCountdownSync|SELECTED_MATCH_REALTIME_1S_SYNC_FINAL"');
