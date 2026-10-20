// ASCII-only encoding probe for both client and server sources.
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['server', 'client/src', 'skills', 'tools'];
const EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.css']);
// traditional-looking chars that only appear in UTF8-read-as-GBK mojibake
const MOJI = [0x6DC7, 0x9411, 0x934F, 0x93C2, 0x95B2, 0x74BA, 0x5A23, 0x935C, 0x942F,
  0x7F01, 0x9428, 0x950B, 0x93B4, 0x93B5, 0x9422, 0x93BB, 0x9352, 0x947E, 0x9314,
  0x941E, 0x942D, 0x935D];
const mojiSet = new Set(MOJI.map((c) => String.fromCharCode(c)));

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(p).toLowerCase())) out.push(p);
  }
}

const files = [];
for (const r of ROOTS) if (fs.existsSync(r)) walk(r, files);

let bad = 0;
for (const f of files.sort()) {
  const s = fs.readFileSync(f, 'utf8');
  if ((s.match(/[\u4e00-\u9fff]/g) || []).length === 0) continue;
  let mark = 0;
  for (const ch of s) if (mojiSet.has(ch)) mark++;
  const fffd = (s.match(/\uFFFD/g) || []).length;
  if (mark > 0 || fffd > 0) {
    bad++;
    console.log('DAMAGED ' + f.padEnd(46) + ' moji=' + mark + ' fffd=' + fffd);
  }
}
console.log('checked=' + files.length + ' damaged=' + bad);
