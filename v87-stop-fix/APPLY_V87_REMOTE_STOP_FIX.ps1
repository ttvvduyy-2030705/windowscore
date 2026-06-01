$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
Write-Host "Aplus remote v87 STOP fix - root: $root"

function ReadText([string]$path) {
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}
function WriteText([string]$path, [string]$text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}
function InsertBeforeFirstRegex([string]$text, [string]$pattern, [string]$insertText) {
  $m = [regex]::Match($text, $pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
  if (-not $m.Success) { return $text }
  return $text.Substring(0, $m.Index) + $insertText + $text.Substring($m.Index)
}

# 1) Native Windows map: VK_MEDIA_STOP 178 must produce STOP.
$cppPath = Join-Path $root 'windows\billiardsgrade\WindowsRemoteControlModule.cpp'
if (Test-Path $cppPath) {
  $cpp = ReadText $cppPath
  $beforeCpp = $cpp

  # Remove every old case 178 block first, to avoid C2196 duplicate case errors.
  $cpp = [regex]::Replace(
    $cpp,
    '(?m)^\s*case\s+178\s*:\s*(?://[^\r\n]*)?\r?\n\s*return\s+"[^"]+"\s*;\r?\n?',
    ''
  )

  $stopCase = @"
        case 178: // VK_MEDIA_STOP / physical Stop
            return "STOP";
"@

  if ($cpp -match '(?m)^\s*case\s+179\s*:') {
    $cpp = InsertBeforeFirstRegex $cpp '(?m)^\s*case\s+179\s*:' ($stopCase + "`r`n")
  } elseif ($cpp -match '(?m)^\s*default\s*:') {
    $cpp = InsertBeforeFirstRegex $cpp '(?m)^\s*default\s*:' ($stopCase + "`r`n")
  } else {
    Write-Host 'WARN: Native switch default/case179 not found. Could not insert case 178 automatically.'
  }

  if ($cpp -ne $beforeCpp) {
    WriteText $cppPath $cpp
    Write-Host 'Patched WindowsRemoteControlModule.cpp: VK_MEDIA_STOP 178 -> STOP, duplicate 178 removed.'
  } else {
    Write-Host 'Native file unchanged.'
  }
} else {
  Write-Host "WARN: not found: $cppPath"
}

# 2) JS normalize map: make sure any raw 178 / MEDIA_STOP becomes STOP.
$remotePath = Join-Path $root 'src\utils\remote.windows.tsx'
if (Test-Path $remotePath) {
  $remote = ReadText $remotePath
  $beforeRemote = $remote

  $remote = [regex]::Replace($remote, "'178'\s*:\s*'[^']+'", "'178': 'STOP'")
  $remote = [regex]::Replace($remote, '"178"\s*:\s*"[^"]+"', '"178": "STOP"')
  $remote = [regex]::Replace($remote, 'MEDIA_STOP\s*:\s*''[^'']+''', "MEDIA_STOP: 'STOP'")
  $remote = [regex]::Replace($remote, 'MEDIA_STOP\s*:\s*"[^"]+"', 'MEDIA_STOP: "STOP"')

  if ($remote -notmatch "'178'\s*:\s*'STOP'" -and $remote -match "'177'\s*:") {
    $remote = [regex]::Replace($remote, "(\s*'177'\s*:\s*'[^']+'\s*,)", "`$1`r`n      '178': 'STOP',", 1)
  }
  if ($remote -notmatch 'MEDIA_STOP\s*:') {
    $remote = [regex]::Replace($remote, "(\s*STOP\s*:\s*'STOP'\s*,)", "`$1`r`n      MEDIA_STOP: 'STOP',", 1)
  }

  if ($remote -ne $beforeRemote) {
    WriteText $remotePath $remote
    Write-Host 'Patched remote.windows.tsx: 178/MEDIA_STOP -> STOP.'
  } else {
    Write-Host 'remote.windows.tsx already has STOP mapping or no change needed.'
  }
} else {
  Write-Host "WARN: not found: $remotePath"
}

# 3) Gameplay JS handler. If the current source already has a STOP handler/log, do not touch it.
$gamePath = Join-Path $root 'src\scenes\game\game-play\GamePlayViewModel.tsx'
if (Test-Path $gamePath) {
  $game = ReadText $gamePath
  $beforeGame = $game

  if ($game -match '\[Remote\]\[Stop\]') {
    Write-Host 'GamePlayViewModel.tsx already contains a remote STOP handler/log. Skipping JS handler insertion.'
  } else {
    if ($game -notmatch 'const\s+onRemoteStopTimer\s*=\s*useCallback') {
      $stopHandler = @'

  const onRemoteStopTimer = useCallback(() => {
    console.log('[Remote][Stop] pressed', {isStarted, isPaused, isMatchPaused});

    // Stop chi dung countdown trong tran; khong stop live, khong stop ghi hinh, khong new game.
    if (!isStarted || isPaused) {
      return;
    }

    setIsMatchPaused(true);
  }, [isStarted, isPaused, isMatchPaused]);
'@
      if ($game -match '\r?\n\s*const\s+onRemoteBreak\s*=\s*useCallback') {
        $game = [regex]::Replace($game, '(\r?\n\s*const\s+onRemoteBreak\s*=\s*useCallback)', $stopHandler + '$1', 1)
      } elseif ($game -match '\r?\n\s*useEffect\s*\(\s*\(\)\s*=>\s*\{\s*\r?\n\s*remoteHandlersRef\.current\s*=\s*\{') {
        $game = [regex]::Replace($game, '(\r?\n\s*useEffect\s*\(\s*\(\)\s*=>\s*\{\s*\r?\n\s*remoteHandlersRef\.current\s*=\s*\{)', $stopHandler + '$1', 1)
      } else {
        Write-Host 'WARN: Could not find insertion point for onRemoteStopTimer. Continuing with mapping only.'
      }
    }

    if ($game -match 'stop\s*:\s*[^,\r\n]+,') {
      $game = [regex]::Replace($game, 'stop\s*:\s*[^,\r\n]+,', 'stop: onRemoteStopTimer,', 1)
    } elseif ($game -match 'warmUp\s*:\s*[^,\r\n]+,') {
      $game = [regex]::Replace($game, '(warmUp\s*:\s*[^,\r\n]+,)', '$1' + "`r`n      stop: onRemoteStopTimer,", 1)
    }

    if ($game -notmatch 'RemoteControlKeys\.STOP') {
      $stopRegister = @'
    RemoteControl.instance.registerKeyEvents(
      RemoteControlKeys.STOP,
      () => remoteHandlersRef.current.stop(),
    );
'@
      if ($game -match 'RemoteControl\.instance\.registerKeyEvents\(\s*\r?\n\s*RemoteControlKeys\.BREAK') {
        $game = [regex]::Replace($game, '(\s*RemoteControl\.instance\.registerKeyEvents\(\s*\r?\n\s*RemoteControlKeys\.BREAK)', "`r`n" + $stopRegister + '$1', 1)
      }
    }

    if ($game -ne $beforeGame) {
      WriteText $gamePath $game
      Write-Host 'Patched GamePlayViewModel.tsx STOP handler/register.'
    } else {
      Write-Host 'GamePlayViewModel.tsx unchanged after STOP handler check.'
    }
  }
} else {
  Write-Host "WARN: not found: $gamePath"
}

Write-Host 'Done v87 STOP fix.'
Write-Host 'Now run:'
Write-Host 'cd C:\project\windowscore'
Write-Host 'taskkill /IM billiardsgrade.exe /F 2>$null'
Write-Host 'npx react-native run-windows'
