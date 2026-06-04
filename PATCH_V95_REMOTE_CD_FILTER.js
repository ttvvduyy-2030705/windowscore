const fs = require("fs");

const p = "windows/billiardsgrade/WindowsRemoteControlModule.cpp";
let c = fs.readFileSync(p, "utf8");
const backup = p + ".bak_v95_cd_filter_" + Date.now();
fs.copyFileSync(p, backup);

function fail(msg) {
  console.error("FAIL:", msg);
  console.error("Backup:", backup);
  process.exit(1);
}

function save() {
  fs.writeFileSync(p, c, "utf8");
}

function showAround(title, pattern) {
  const lines = c.split(/\r?\n/);
  const idx = lines.findIndex(l => pattern.test(l));
  console.log("\n=== " + title + " ===");
  if (idx < 0) {
    console.log("not found");
    return;
  }
  for (let i = Math.max(0, idx - 4); i <= Math.min(lines.length - 1, idx + 8); i++) {
    console.log(String(i + 1).padStart(5) + ": " + lines[i]);
  }
}

console.log("Backup:", backup);

// 1) FIX CHÍNH: tầng keyboard hook filter đang thiếu C/D.
// Đoạn hiện tại có case 'A', case 'B', rồi nhảy sang E/N/P.
// Thêm C/D vào đây để app thật sự nhận được phím C/D từ remote.
if (!/case\s+'C'\s*:[\s\S]*case\s+'D'\s*:/.test(c)) {
  const before = c;
  c = c.replace(
    /(case\s+'A'\s*:\s*\r?\n\s*case\s+'B'\s*:\s*\r?\n)(\s*case\s+'E'\s*:)/,
    `$1        case 'C': // APLUS remote Stop sends keyboard C
        case 'D': // APLUS remote Break sends keyboard D
$2`
  );
  if (c === before) {
    fail("Không tìm thấy block filter case 'A' / case 'B' / case 'E' để chèn C/D.");
  }
  console.log("Patched hook filter: allow C/D.");
} else {
  console.log("Hook filter already has C/D.");
}

// 2) Map trực tiếp vkey 67/68 thành command STOP/BREAK ở switch virtual-key.
// Không map vòng qua chữ C/D nữa.
if (!/case\s+67\s*:[\s\S]{0,120}return\s+"STOP"\s*;/.test(c)) {
  const before = c;
  c = c.replace(
    /(case\s+32\s*:\s*\r?\n\s*case\s+65\s*:\s*\r?\n\s*case\s+80\s*:\s*\r?\n\s*case\s+179\s*:\s*\r?\n\s*return\s+"START"\s*;\s*\r?\n)(\s*case\s+83\s*:)/,
    `$1        case 67: // APLUS remote Stop sends keyboard C
            return "STOP";
        case 68: // APLUS remote Break sends keyboard D
            return "BREAK";
$2`
  );
  if (c === before) {
    fail("Không tìm thấy switch map virtual-key START -> case 83 để chèn 67/68.");
  }
  console.log("Patched virtual-key map: 67->STOP, 68->BREAK.");
} else {
  console.log("Virtual-key map already has 67->STOP.");
}

// 3) Map tên phím C/D để log nhìn rõ rawResolvedKey = C/D.
if (!/case\s+67\s*:[\s\S]{0,80}return\s+"C"\s*;/.test(c)) {
  const before = c;
  c = c.replace(
    /(case\s+66\s*:\s*\r?\n\s*return\s+"B"\s*;\s*\r?\n)(\s*case\s+222\s*:)/,
    `$1        case 67:
            return "C";
        case 68:
            return "D";
$2`
  );
  if (c === before) {
    fail("Không tìm thấy switch resolve key name case 66 -> B để chèn C/D.");
  }
  console.log("Patched key name map: 67->C, 68->D.");
} else {
  console.log("Key name map already has C/D.");
}

// 4) Chuẩn hóa string key: D/68 cũng phải vào BREAK.
// Output check hiện STOP có 67 rồi, BREAK chưa có 68 ở dòng normalize.
if (!/key\s*==\s*"68"[\s\S]{0,500}return\s+"BREAK"\s*;/.test(c)) {
  const before = c;
  c = c.replace(
    /if\s*\(\s*key\s*==\s*"32"/,
    `if (key == "68" || key == "D" || key == "32"`
  );
  if (c === before) {
    fail("Không tìm thấy dòng normalize BREAK bắt đầu bằng key == \"32\".");
  }
  console.log("Patched normalize: 68/D -> BREAK.");
} else {
  console.log("Normalize already has 68/D -> BREAK.");
}

// Verify trước khi ghi
if (!/case\s+'C'\s*:/.test(c) || !/case\s+'D'\s*:/.test(c)) fail("Verify fail: filter chưa có case 'C'/'D'.");
if (!/case\s+67\s*:[\s\S]{0,160}return\s+"STOP"\s*;/.test(c)) fail("Verify fail: chưa có case 67 -> STOP.");
if (!/case\s+68\s*:[\s\S]{0,160}return\s+"BREAK"\s*;/.test(c)) fail("Verify fail: chưa có case 68 -> BREAK.");

save();

showAround("HOOK FILTER C/D", /case\s+'C'\s*:/);
showAround("VKEY 67/68 MAP", /case\s+67\s*:/);
showAround("KEY NAME C/D", /return\s+"C"\s*;/);

console.log("\nDONE v95. Chỉ sửa:", p);
