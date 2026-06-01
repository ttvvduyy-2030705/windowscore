
$ErrorActionPreference = "Stop"

function Write-Ok($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host $msg -ForegroundColor Yellow }
function Write-Err2($msg) { Write-Host $msg -ForegroundColor Red }

$root = (Get-Location).Path
$gamePath = Join-Path $root "src\scenes\game\game-play\GamePlayViewModel.tsx"
$remotePath = Join-Path $root "src\utils\remote.windows.tsx"
$cppPath = Join-Path $root "windows\billiardsgrade\WindowsRemoteControlModule.cpp"

if (!(Test-Path $gamePath)) { throw "Khong thay $gamePath. Hay cd vao C:\project\windowscore truoc." }
if (!(Test-Path $cppPath)) { throw "Khong thay $cppPath. Hay cd vao C:\project\windowscore truoc." }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $root ".backup-v85-remote-stop-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item $gamePath (Join-Path $backupDir "GamePlayViewModel.tsx.bak") -Force
Copy-Item $cppPath (Join-Path $backupDir "WindowsRemoteControlModule.cpp.bak") -Force
if (Test-Path $remotePath) { Copy-Item $remotePath (Join-Path $backupDir "remote.windows.tsx.bak") -Force }

# -------------------------------------------------------------------
# 1) Native Windows HID: map physical media Stop key (VK_MEDIA_STOP = 178)
#    to app command STOP. This should not touch volume keys.
# -------------------------------------------------------------------
$cpp = Get-Content -Raw -Encoding UTF8 $cppPath
$prefix = ""
if ($cpp -match 'return\s+L"START"') { $prefix = "L" }

if ($cpp -notmatch 'Aplus Remote Stop v85') {
    $stopCase = @"

        case 178: // Aplus Remote Stop v85: VK_MEDIA_STOP
            return ${prefix}"STOP";
"@

    if ($cpp -match 'case\s+178\s*:') {
        # If a 178 case already exists, just try to make that case return STOP.
        $cpp = [regex]::Replace(
            $cpp,
            '(case\s+178\s*:[\s\S]{0,260}?return\s+)(L?)"[^"]+"(\s*;)',
            ('$1' + $prefix + '"STOP"$3'),
            1
        )
        if ($cpp -notmatch 'Aplus Remote Stop v85') {
            $cpp = $cpp -replace '(case\s+178\s*:)', '$1 // Aplus Remote Stop v85'
        }
        Write-Ok "Patched existing case 178 -> STOP in WindowsRemoteControlModule.cpp"
    }
    elseif ($cpp -match 'case\s+VK_MEDIA_STOP\s*:') {
        $cpp = [regex]::Replace(
            $cpp,
            '(case\s+VK_MEDIA_STOP\s*:[\s\S]{0,260}?return\s+)(L?)"[^"]+"(\s*;)',
            ('$1' + $prefix + '"STOP"$3'),
            1
        )
        if ($cpp -notmatch 'Aplus Remote Stop v85') {
            $cpp = $cpp -replace '(case\s+VK_MEDIA_STOP\s*:)', '$1 // Aplus Remote Stop v85'
        }
        Write-Ok "Patched existing VK_MEDIA_STOP -> STOP in WindowsRemoteControlModule.cpp"
    }
    elseif ($cpp -match 'case\s+(?:13|VK_RETURN)\s*:') {
        $cpp = [regex]::Replace($cpp, '(\r?\n\s*case\s+(?:13|VK_RETURN)\s*:)', $stopCase + '$1', 1)
        Write-Ok "Inserted case 178 -> STOP before ENTER/NEW_GAME mapping"
    }
    elseif ($cpp -match 'default\s*:') {
        $cpp = [regex]::Replace($cpp, '(\r?\n\s*default\s*:)', $stopCase + '$1', 1)
        Write-Ok "Inserted case 178 -> STOP before default mapping"
    }
    else {
        throw "Khong tim duoc vi tri chen case 178 trong WindowsRemoteControlModule.cpp"
    }

    Set-Content -Encoding UTF8 $cppPath $cpp
} else {
    Write-Warn2 "WindowsRemoteControlModule.cpp da co Aplus Remote Stop v85, bo qua."
}

# -------------------------------------------------------------------
# 2) JS gameplay: handle STOP as pause/countdown stop only.
#    It should NOT stop replay/recording and should NOT start a new game.
# -------------------------------------------------------------------
$game = Get-Content -Raw -Encoding UTF8 $gamePath

if ($game -notmatch 'Aplus Remote Stop v85') {
    $pauseSetter = $null
    foreach ($name in @('setIsPaused','setPaused','setPause','setGamePaused')) {
        if ($game -match ('\b' + [regex]::Escape($name) + '\s*\(')) {
            $pauseSetter = $name
            break
        }
    }
    if (-not $pauseSetter) {
        throw "Khong tim thay setter pause trong GamePlayViewModel.tsx (setIsPaused/setPaused/...)."
    }

    # Find the START remote branch near the existing log line.
    $mLog = [regex]::Match($game, "console\.(?:log|warn)\s*\(\s*['""]\[Remote\]\[Start\] pressed")
    if (-not $mLog.Success) {
        throw "Khong tim thay log [Remote][Start] pressed trong GamePlayViewModel.tsx"
    }

    $beforeLog = $game.Substring(0, $mLog.Index)
    $ifMatches = [regex]::Matches($beforeLog, "(?m)^(?<indent>\s*)if\s*\((?<cond>[^\r\n]*['""]START['""][^\r\n]*)\)\s*\{\s*$")
    if ($ifMatches.Count -eq 0) {
        # Fallback: find any nearby line that contains START and if (
        $windowStart = [Math]::Max(0, $mLog.Index - 2500)
        $window = $game.Substring($windowStart, $mLog.Index - $windowStart)
        $near = [regex]::Matches($window, "(?m)^(?<indent>\s*)if\s*\((?<cond>[^\r\n]*['""]START['""][^\r\n]*)\)\s*\{\s*$")
        if ($near.Count -eq 0) {
            throw "Khong tim thay if START branch de chen STOP branch."
        }
        $target = $near[$near.Count - 1]
        $targetIndex = $windowStart + $target.Index
    } else {
        $target = $ifMatches[$ifMatches.Count - 1]
        $targetIndex = $target.Index
    }

    $cond = $target.Groups["cond"].Value
    $indent = $target.Groups["indent"].Value

    # Pick the variable used in "... === 'START'".
    $lhs = $null
    $lhsMatch = [regex]::Match($cond, "([A-Za-z0-9_\.\?\[\]`"']+)\s*={2,3}\s*['""]START['""]")
    if ($lhsMatch.Success) {
        $lhs = $lhsMatch.Groups[1].Value
    } else {
        $lhsMatch = [regex]::Match($cond, "['""]START['""]\s*={2,3}\s*([A-Za-z0-9_\.\?\[\]`"']+)")
        if ($lhsMatch.Success) { $lhs = $lhsMatch.Groups[1].Value }
    }
    if (-not $lhs) {
        throw "Khong xac dinh duoc bien remote command trong START branch."
    }

    $stopBlock = @"
${indent}// Aplus Remote Stop v85: stop/pause countdown only, keep recording/live session running
${indent}if (${lhs} === 'STOP') {
${indent}  console.log('[Remote][Stop] pressed', {isStarted, isPaused});
${indent}  if (isStarted) {
${indent}    ${pauseSetter}(true);
${indent}  }
${indent}  return;
${indent}}

"@

    $game = $game.Insert($targetIndex, $stopBlock)
    Set-Content -Encoding UTF8 $gamePath $game
    Write-Ok "Inserted STOP handler in GamePlayViewModel.tsx using $lhs and $pauseSetter(true)"
} else {
    Write-Warn2 "GamePlayViewModel.tsx da co Aplus Remote Stop v85, bo qua."
}

# -------------------------------------------------------------------
# 3) Optional JS normalizer: ensure STOP strings pass through if this file
#    has an explicit known-key list.
# -------------------------------------------------------------------
if (Test-Path $remotePath) {
    $remote = Get-Content -Raw -Encoding UTF8 $remotePath
    $changed = $false

    if ($remote -notmatch 'Aplus Remote Stop v85') {
        # Add STOP to arrays/unions near START when easy and safe.
        $remote2 = $remote
        $remote2 = [regex]::Replace($remote2, "(['""]START['""]\s*,)", '$1 ''STOP'', // Aplus Remote Stop v85' , 1)
        if ($remote2 -ne $remote) {
            Set-Content -Encoding UTF8 $remotePath $remote2
            $changed = $true
            Write-Ok "Added STOP near START in remote.windows.tsx"
        }
    }

    if (-not $changed) {
        Write-Warn2 "remote.windows.tsx khong can patch hoac khong tim thay list START an toan."
    }
}

Write-Host ""
Write-Ok "DONE v85 remote Stop fix."
Write-Host "Backup: $backupDir"
Write-Host ""
Write-Host "Now run:"
Write-Host "cd C:\project\windowscore"
Write-Host "taskkill /IM billiardsgrade.exe /F 2>`$null"
Write-Host "npx react-native run-windows"
Write-Host ""
Write-Host "Test: vao tran -> bam Start cho timer chay -> bam nut Stop."
Write-Host "Metro nen hien: [Remote][Stop] pressed. Neu van khong hien, gui log dung doan bam Stop de map tiep rawKeyCode."
