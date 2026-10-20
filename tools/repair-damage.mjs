// 备用修复工具：上下文反推法还原 "字符第 3 字节被替换" 型损坏（如 "X1?7"）
//
// 思路：把损坏区域当作"未知"，用它在文件中前后的原文上下文到 git HEAD 里查找同一句，
// 上下文之间被吃掉的那 1~2 个字符就是原文；多数意见一致时建立映射表，再套用到全文。
//
// 注意：当有 VS Code 本地历史快照时，优先用 tools/restore-from-history.mjs（更准）。
//
// 用法：
//   node tools/repair-damage.mjs <文件...> [--write] [--report]

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const MARKER = Buffer.from([0x84, 0x31, 0xa4, 0x37]);
const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes('--write');
const REPORT = ARGS.includes('--report');
const files = ARGS.filter((a) => !a.startsWith('-'));

const isCont = (b) => b >= 0x80 && b <= 0xbf;

function decodeAt(buf, i) {
  const b = buf[i];
  if (b < 0x80) return { char: String.fromCharCode(b), len: 1 };
  if (b >= 0xc2 && b <= 0xdf && isCont(buf[i + 1])) return { char: buf.slice(i, i + 2).toString('utf8'), len: 2 };
  if (b >= 0xe0 && b <= 0xef && isCont(buf[i + 1]) && isCont(buf[i + 2])) return { char: buf.slice(i, i + 3).toString('utf8'), len: 3 };
  if (b >= 0xf0 && b <= 0xf4 && isCont(buf[i + 1]) && isCont(buf[i + 2]) && isCont(buf[i + 3])) return { char: buf.slice(i, i + 4).toString('utf8'), len: 4 };
  return null;
}

// 把文件切成 [普通字符串 | {dmg: 损坏字节}] 序列
function tokenize(buf) {
  const items = [];
  let plain = '';
  let i = 0;
  while (i < buf.length) {
    const d = decodeAt(buf, i);
    if (d) {
      plain += d.char;
      i += d.len;
      continue;
    }
    const at = buf.indexOf(MARKER, i);
    if (at < 0 || at - i > 8) {
      plain += '\uFFFD';
      i += 1;
      continue;
    }
    if (plain) items.push(plain);
    plain = '';
    items.push({ dmg: buf.slice(i, at + MARKER.length) });
    i = at + MARKER.length;
  }
  if (plain) items.push(plain);
  return items;
}

function headOf(rel) {
  try {
    return execSync(`git show HEAD:${rel}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// 用上下文在 headText 里反推被吃掉的 1~2 个字符
function infer(headText, before, after) {
  const found = [];
  let from = 0;
  while (true) {
    const at = headText.indexOf(before, from);
    if (at < 0) break;
    from = at + 1;
    const tail = headText.slice(at + before.length);
    for (let n = 1; n <= 2; n++) {
      if (tail.slice(n, n + after.length) === after && tail.slice(0, n)) {
        found.push(tail.slice(0, n));
        break;
      }
    }
  }
  const uniq = [...new Set(found)];
  return uniq.length === 1 ? uniq[0] : null;
}

const table = new Map(); // hex(dmg) -> Map(original -> count)
const work = [];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log('SKIP 不存在: ' + file);
    continue;
  }
  const items = tokenize(fs.readFileSync(file));
  const dmgs = items.filter((x) => typeof x !== 'string');
  if (!dmgs.length) {
    console.log('OK  无损坏: ' + file);
    continue;
  }

  const flat = items.map((x) => (typeof x === 'string' ? x : '\u0000')).join('');
  const marks = [];
  let k = 0;
  for (let i = 0; i < items.length; i++) {
    if (typeof items[i] === 'string') continue;
    const pos = flat.indexOf('\u0000', k);
    k = pos + 1;
    marks.push({
      pos,
      before: flat.slice(Math.max(0, pos - 24), pos),
      after: flat.slice(pos + 1, pos + 25),
      dmg: items[i].dmg,
    });
  }

  const headText = headOf(path.relative(process.cwd(), file).split(path.sep).join('/'));
  let resolved = 0;
  for (const m of marks) {
    const orig = headText ? infer(headText, m.before, m.after) : null;
    const key = m.dmg.toString('hex');
    if (!table.has(key)) table.set(key, new Map());
    if (orig) {
      const t = table.get(key);
      t.set(orig, (t.get(orig) || 0) + 1);
      m.orig = orig;
      resolved++;
    }
  }
  work.push({ file, items, marks });
  console.log(`${file}: 损坏 ${dmgs.length} 处，上下文反推成功 ${resolved}`);
}

const vote = (dmg) => {
  const m = table.get(dmg.toString('hex'));
  if (!m || !m.size) return null;
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length > 1 && rows[0][1] === rows[1][1]) return null;
  return rows[0][0];
};

let unresolved = 0;
let written = 0;
for (const w of work) {
  for (const m of w.marks) if (!m.orig) m.orig = vote(m.dmg);
  const left = w.marks.filter((m) => !m.orig).length;
  unresolved += left;
  if (REPORT) {
    for (const m of w.marks.slice(0, 10)) {
      console.log(`  ${JSON.stringify(m.before.slice(-12))} [${m.dmg.toString('hex')}] ${JSON.stringify(m.after.slice(0, 12))} -> ${m.orig ? JSON.stringify(m.orig) : '(未解决)'}`);
    }
  }
  if (!WRITE) continue;
  let out = '';
  let mi = 0;
  for (const item of w.items) out += typeof item === 'string' ? item : w.marks[mi++].orig || '\uFFFD';
  fs.writeFileSync(w.file, out, 'utf8');
  written++;
}

console.log(`\n映射表 ${table.size} 条；${WRITE ? `已写出 ${written} 个文件` : '（未写盘，加 --write 生效）'}；仍无法还原 ${unresolved} 处`);
if (unresolved) console.log('未能还原的多为"HEAD 里没有的新增内容"，需要人工补写或改用 local history 快照恢复。');
