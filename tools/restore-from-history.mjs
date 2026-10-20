// 从 VS Code 本地历史快照（Timeline）恢复被损坏的文件
//
// 背景：批量编码事故会把文件里的中文改坏（字符被替换成 "X1?7"，有损）。
// VS Code 会把"文件被打开/保存过"的版本留在本地历史里：
//   C:\Users\<你>\AppData\Roaming\Code\User\History\<hash>\entries.json + 快照文件
// 本工具按 data/snap-data.json 的清单恢复，并做三重校验后才写盘：
//   1) 行数必须与当前（损坏）文件完全一致
//   2) 未被损坏的行，其 ASCII 骨架必须与快照逐行一致（证明是同一版本，只是编码坏了）
//   3) 快照必须能干净解码（UTF-8 或 GBK，无 U+FFFD）
//
// 用法：
//   node tools/restore-from-history.mjs            # 干跑（只报告）
//   node tools/restore-from-history.mjs --write    # 实际写盘
//
// 清单（data/snap-data.json）由"查找快照"脚本生成：遍历历史目录，
// 找到 resource 指向同一路径、且能干净解码、行数一致的最新快照。

import fs from 'node:fs';

const WRITE = process.argv.includes('--write');
const PLAN = 'data/snap-data.json';

if (!fs.existsSync(PLAN)) {
  console.log('缺少 ' + PLAN + '（先运行快照扫描脚本生成清单）');
  process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));

const asciiSkeleton = (t) => t.replace(/[^\x00-\x7f]/g, '').replace(/\r/g, '');

let ok = 0;
let skipped = 0;
for (const s of plan) {
  if (!fs.existsSync(s.file)) {
    console.log('SKIP 缺少文件 ' + s.file);
    skipped++;
    continue;
  }
  if (s.kind !== 'gbk' && s.kind !== 'utf8') {
    console.log('SKIP 快照不可解码 ' + s.file);
    skipped++;
    continue;
  }

  const cur = fs.readFileSync(s.file, 'utf8').replace(/\r/g, '');
  const snap = String(s.text).replace(/\r/g, '');
  const curLines = cur.split('\n');
  const snapLines = snap.split('\n');
  if (curLines.length !== snapLines.length) {
    console.log(`SKIP 行数不同 ${s.file}（当前 ${curLines.length} / 快照 ${snapLines.length}）`);
    skipped++;
    continue;
  }

  // 逐行校验：未被损坏的行（不含 U+FFFD）其 ASCII 骨架必须与快照一致
  let mismatched = 0;
  const samples = [];
  for (let i = 0; i < curLines.length; i++) {
    if (curLines[i].includes('\uFFFD')) continue;
    if (asciiSkeleton(curLines[i]) !== asciiSkeleton(snapLines[i])) {
      mismatched++;
      if (samples.length < 2) samples.push({ line: i + 1, cur: curLines[i].slice(0, 70), snap: snapLines[i].slice(0, 70) });
    }
  }
  if (mismatched > 0) {
    console.log(`SKIP 有 ${mismatched} 行与快照不一致 ${s.file}`);
    for (const x of samples) {
      console.log(`   L${x.line} 当前: ${x.cur}`);
      console.log(`   L${x.line} 快照: ${x.snap}`);
    }
    skipped++;
    continue;
  }

  if (WRITE) {
    fs.writeFileSync(s.file, snap.replace(/\r\n/g, '\n'), 'utf8');
    console.log(`RESTORED ${s.file}  (${snapLines.length} 行, 快照 ${s.ts})`);
  } else {
    console.log(`OK 可恢复 ${s.file}  (${snapLines.length} 行, 快照 ${s.ts})`);
  }
  ok++;
}
console.log(`\n${WRITE ? '已恢复' : '可恢复'} ${ok} 个文件，跳过 ${skipped} 个${WRITE ? '' : '（加 --write 生效）'}`);
