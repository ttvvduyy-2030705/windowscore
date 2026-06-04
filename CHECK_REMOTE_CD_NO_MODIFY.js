const fs = require("fs");

const cppPath = "windows/billiardsgrade/WindowsRemoteControlModule.cpp";
const tsxPath = "src/scenes/game/game-play/GamePlayViewModel.tsx";
const remotePath = "src/utils/remote.windows.tsx";

function read(p) {
  if (!fs.existsSync(p)) {
    console.log("MISSING:", p);
    return "";
  }
  return fs.readFileSync(p, "utf8");
}

function yes(name, ok) {
  console.log((ok ? "OK   " : "FAIL ") + name);
}

const cpp = read(cppPath);
const tsx = read(tsxPath);
const remote = read(remotePath);

console.log("\n=== NATIVE CPP CHECK ===");
yes("native co case/phim A = START", /case\s+65|case\s+'A'|VK_KEY_A|return\s+"START"/.test(cpp));
yes("native co case/phim B = WARM_UP", /case\s+66|case\s+'B'|VK_KEY_B|return\s+"WARM_UP"/.test(cpp));
yes("native co case/phim C = STOP", /case\s+67|case\s+'C'|VK_KEY_C|return\s+"STOP"/.test(cpp));
yes("native co case/phim D = BREAK", /case\s+68|case\s+'D'|VK_KEY_D|return\s+"BREAK"/.test(cpp));

console.log("\n=== FILTER A/B/C/D AROUND LINES ===");
const lines = cpp.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const s = lines[i];
  if (
    /case\s+65|case\s+66|case\s+67|case\s+68|case\s+'A'|case\s+'B'|case\s+'C'|case\s+'D'|return\s+"START"|return\s+"WARM_UP"|return\s+"STOP"|return\s+"BREAK"/.test(s)
  ) {
    const from = Math.max(0, i - 2);
    const to = Math.min(lines.length - 1, i + 3);
    console.log("\n--- around line " + (i + 1) + " ---");
    for (let j = from; j <= to; j++) {
      console.log(String(j + 1).padStart(5) + ": " + lines[j]);
    }
  }
}

console.log("\n=== JS HANDLER CHECK ===");
yes("GamePlay co Remote Stop handler/log", /\[Remote\]\[Stop\]|onRemoteStop|RemoteControlKeys\.STOP|['"]STOP['"]/.test(tsx));
yes("GamePlay co Remote Break handler/log", /\[Remote\]\[Break\]|onRemoteBreak|RemoteControlKeys\.BREAK|['"]BREAK['"]/.test(tsx));
yes("remote.windows co STOP", /STOP/.test(remote));
yes("remote.windows co BREAK", /BREAK/.test(remote));

console.log("\n=== DIAGNOSIS ===");
if (!(/case\s+67|case\s+'C'|VK_KEY_C|return\s+"STOP"/.test(cpp))) {
  console.log("Native thieu C->STOP. Can sua native, chua sua JS.");
}
if (!(/case\s+68|case\s+'D'|VK_KEY_D|return\s+"BREAK"/.test(cpp))) {
  console.log("Native thieu D->BREAK. Can sua native, chua sua JS.");
}
if ((/case\s+67|case\s+'C'|VK_KEY_C|return\s+"STOP"/.test(cpp)) && (/case\s+68|case\s+'D'|VK_KEY_D|return\s+"BREAK"/.test(cpp))) {
  console.log("Native da co C/D. Neu app van khong incoming thi filter hook dang bo qua C/D o cho khac.");
}
