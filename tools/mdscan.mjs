// ASCII: scan md files for mojibake CJK tokens (unicode-escaped)
import fs from 'node:fs';
import path from 'node:path';
const roots = ['README.md', 'docs', 'skills'];
const files = [];
function walk(p) {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const c of fs.readdirSync(p)) {
      if (c === 'node_modules' || c === '.git') continue;
      walk(path.join(p, c));
    }
  } else if (p.endsWith('.md') || p.endsWith('.mjs')) files.push(p);
}
for (const r of roots) walk(r);
// representative mojibake chars (result of utf8-read-as-gbk): use escapes
const tokens = ['\u952f\u65a4\u62f7', '\u93af', '\u7f02', '\u69c3', '\u9ffb']; // 锟斤拷/鎯/缂?/楃?/??
for (const f of files) {
  let s = '';
  try { s = fs.readFileSync(f, 'utf8'); } catch { console.log('INVALID-UTF8', f); continue; }
  let hit = '';
  for (const t of tokens) { if (s.includes(t)) { hit = t; break; } }
  // broader: any of common mojibake leading chars
  if (!hit) {
    const m = s.match(/[\u93af\u7f02\u69c3\u952f\u65a4\u62f7\u7545\u9533\u6ce6\u5ce1\u6d63]/);
    if (m) hit = m[0];
  }
  console.log((hit ? 'MOJIBAKE ' + hit.codePointAt(0).toString(16) : 'clean    ') + '  ' + f);
}
