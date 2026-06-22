const fs = require('fs');
const path = require('path');

const servicePath = path.join(process.cwd(), 'src', 'services', 'aplusLiveScore.ts');

if (!fs.existsSync(servicePath)) {
  throw new Error('Không thấy file src/services/aplusLiveScore.ts');
}

let source = fs.readFileSync(servicePath, 'utf8');

const helperStart = '// APLUS_MATCH_CODE_LOOKUP_START';
const helperEnd = '// APLUS_MATCH_CODE_LOOKUP_END';

const helperCode = `
${helperStart}
export const normalizeAplusMatchCode = (input?: unknown): string | null => {
  if (input === undefined || input === null) {
    return null;
  }

  const raw = String(input).trim().toUpperCase().replace(/\\s+/g, '');

  if (/^T\\d+$/.test(raw)) {
    const number = Number(raw.slice(1));
    return Number.isFinite(number) && number > 0 ? \`T\${number}\` : null;
  }

  if (/^\\d+$/.test(raw)) {
    const number = Number(raw);
    return Number.isFinite(number) && number > 0 ? \`T\${number}\` : null;
  }

  return null;
};

const getAplusMatchCodeCandidates = (match: any): unknown[] => [
  match?.code,
  match?.matchCode,
  match?.matchNumber,
  match?.number,
  match?.name,
  match?.title,
  match?.label,
  match?.raw?.code,
  match?.raw?.matchCode,
  match?.raw?.matchNumber,
  match?.raw?.number,
  match?.raw?.name,
  match?.raw?.title,
  match?.raw?.label,
];

export const findAplusMatchByCode = <T extends any>(
  matches: T[] = [],
  input?: unknown,
): T | null => {
  const normalizedCode = normalizeAplusMatchCode(input);

  if (!normalizedCode) {
    return null;
  }

  return (
    matches.find(match =>
      getAplusMatchCodeCandidates(match).some(
        candidate => normalizeAplusMatchCode(candidate) === normalizedCode,
      ),
    ) || null
  );
};
${helperEnd}
`;

if (source.includes(helperStart) && source.includes(helperEnd)) {
  source = source.replace(
    new RegExp(`${helperStart}[\\s\\S]*?${helperEnd}`),
    helperCode.trim(),
  );
} else {
  const insertAt = source.indexOf('const getArrayFromResponse');
  if (insertAt >= 0) {
    source = source.slice(0, insertAt) + helperCode + '\n\n' + source.slice(insertAt);
  } else {
    source += '\n\n' + helperCode + '\n';
  }
}

function findFunctionRange(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) {
    throw new Error(`Không tìm thấy function: ${marker}`);
  }

  const open = text.indexOf('{', start);
  if (open < 0) {
    throw new Error(`Không tìm thấy dấu { cho ${marker}`);
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '{') depth += 1;

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        let end = i + 1;
        while (text[end] && /\\s/.test(text[end])) end += 1;
        if (text[end] === ';') end += 1;
        return { start, end };
      }
    }
  }

  throw new Error(`Không tìm thấy điểm kết thúc function ${marker}`);
}

const replacement = `export const fetchAplusMatchByNumber = async (
  tournament: AplusTournament,
  matchNumber: string | number,
): Promise<AplusLiveMatch | null> => {
  console.log('[INPUT]', matchNumber);

  const normalizedCode = normalizeAplusMatchCode(matchNumber);

  console.log('[NORMALIZED]', normalizedCode);

  if (!normalizedCode) {
    throw new Error('Mã trận không hợp lệ. Nhập dạng T5 hoặc 5.');
  }

  const rawMatches = await fetchFreshMatchListForTournament(tournament);

  const normalizedMatches = rawMatches
    .map(match => {
      try {
        return normalizeLiveMatch(match, tournament);
      } catch (_error) {
        return match as AplusLiveMatch;
      }
    })
    .filter(Boolean);

  const match = findAplusMatchByCode(normalizedMatches, normalizedCode);

  console.log(
    '[FOUND MATCH]',
    match
      ? normalizeAplusMatchCode(
          (match as any).code ||
            (match as any).matchCode ||
            (match as any).matchNumber ||
            (match as any).name ||
            (match as any).raw?.code ||
            (match as any).raw?.matchCode ||
            (match as any).raw?.matchNumber ||
            (match as any).raw?.name,
        )
      : undefined,
  );

  if (!match) {
    return null;
  }

  return match;
};`;

const range = findFunctionRange(source, 'export const fetchAplusMatchByNumber');
source = source.slice(0, range.start) + replacement + source.slice(range.end);

fs.writeFileSync(servicePath, source, 'utf8');

console.log('DONE fixed:', servicePath);
console.log('Added normalizeAplusMatchCode');
console.log('Added findAplusMatchByCode');
console.log('Replaced fetchAplusMatchByNumber with code-based lookup');
