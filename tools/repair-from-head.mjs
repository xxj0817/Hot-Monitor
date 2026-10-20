// ASCII-only repair: fix U+FFFD-damaged lines by borrowing the matching line text from git HEAD.
// usage: node tools/repair-from-head.mjs <file> [<file> ...] [--write] [--debug]
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const debug = argv.includes('--debug');
const files = argv.filter((a) => a.startsWith('--') === false);

const asciiOf = (s) => s.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();

function lcsLen(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Uint16Array(n + 1);
  let cur = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    const t = prev; prev = cur; cur = t;
    cur.fill(0);
  }
  return prev[n];
}

function ratio(a, b) {
  const A = asciiOf(a);
  const B = asciiOf(b);
  if (A === '' || B === '') return 0;
  return (2 * lcsLen(A, B)) / (A.length + B.length);
}

let total = 0;
for (const f of files) {
  let head = '';
  try {
    head = execSync('git show HEAD:' + f, { encoding: 'utf8', maxBuffer: 5e8 });
  } catch {
    console.log('SKIP (no HEAD copy):', f);
    continue;
  }
  const cur = fs.readFileSync(f, 'utf8');
  const curLines = cur.split('\n');
  const headLines = head.split('\n');
  const used = new Set();
  let fixed = 0;
  const out = curLines.map((line, idx) => {
    if (line.indexOf('\uFFFD') < 0) return line;
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < headLines.length; i++) {
      if (used.has(i)) continue;
      const h = headLines[i];
      if (h.indexOf('\uFFFD') >= 0) continue;
      if (/[\u3400-\u9fff]/.test(h) === false) continue;
      const sc = ratio(line, h);
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    if (debug) console.log('  score=' + bestScore.toFixed(3), 'head#' + (best + 1));
    if (best >= 0 && bestScore >= Number(process.env.MIN_SCORE || 0.9)) {
      used.add(best);
      fixed++;
      const h = headLines[best].replace(/\r$/, '');
      return line.endsWith('\r') ? h + '\r' : h;
    }
    console.log('  UNMATCHED ' + f + ':' + (idx + 1), JSON.stringify(line.trim().slice(0, 90)));
    return line;
  });
  if (fixed > 0) {
    total += fixed;
    if (write) fs.writeFileSync(f, out.join('\n'), 'utf8');
  }
  console.log((write ? 'REPAIRED ' : 'DRY-RUN  ') + f + '  lines=' + fixed);
}
console.log('total lines fixed:', total, write ? '(written)' : '(dry run)');
