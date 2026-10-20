// 编码体检工具（项目级）：找出真正损坏的文件
//
// 检测四类问题：
//   1) 非法 UTF-8（含残缺字节）—— Node 读取时会变成 U+FFFD
//   2) U+FFFD 替换符（已在文件里固化的不可逆损失）
//   3) 私用区字符（U+E000-U+F8FF）—— 编码往返损坏的强特征
//   4) 双重编码乱码（UTF-8 被当作 GBK 解码后又存成 UTF-8，如 "鐑偣闆疯揪"）
//   另外区分"仍是 GBK 编码"的文件（需转 UTF-8）
//
// 用法：
//   node tools/enc-audit.mjs                  # 扫描 server / client/src / skills / tools / docs
//   node tools/enc-audit.mjs <目录或文件...>   # 指定范围
//   node tools/enc-audit.mjs --json            # 机器可读输出
//
// 纯 ASCII 源码（中文用 \u 转义），自身不存在编码问题。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.vite', '.cache', 'build', 'data']);
const EXTS = /\.(js|mjs|cjs|jsx|ts|tsx|md|json|jsonl|css|html|ps1|txt|yml|yaml)$/;

// 高置信乱码字（正常简体文本里几乎不会出现；绝不包含常用字）
const HIGH_CONF = [
  '\u9428', '\u951b', '\u9286', '\u9411', '\u95c6', '\u7481', '\u93c2',
  '\u7039', '\u93c4', '\u8b81', '\u9374', '\u93c8', '\u6d93', '\u9492', '\u72bb',
];

function walk(target, out = []) {
  const st = fs.statSync(target);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(target)) {
      if (SKIP_DIRS.has(name)) continue;
      walk(path.join(target, name), out);
    }
  } else if (EXTS.test(target)) {
    out.push(target);
  }
  return out;
}

function auditFile(file) {
  const buf = fs.readFileSync(file);
  if (!buf.length) return null;

  let invalidUtf8 = false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    invalidUtf8 = true;
  }

  const asUtf8 = buf.toString('utf8');
  const fffd = (asUtf8.match(/\uFFFD/g) || []).length;
  const pua = [...asUtf8].filter((c) => c >= '\uE000' && c <= '\uF8FF').length;
  const cjk = [...asUtf8].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
  const highConf = [...asUtf8].filter((c) => HIGH_CONF.includes(c)).length;

  // 是否本来就是 GBK 文件（GBK 解码干净且中文数量可观）
  let gbkClean = false;
  if (invalidUtf8) {
    try {
      const asGbk = new TextDecoder('gbk').decode(buf);
      const bad = (asGbk.match(/\uFFFD/g) || []).length;
      const cjkGbk = [...asGbk].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
      gbkClean = bad === 0 && cjkGbk > 10;
    } catch {
      gbkClean = false;
    }
  }

  const problems = [];
  if (invalidUtf8) problems.push(gbkClean ? 'GBK 编码（需转 UTF-8）' : '非法 UTF-8（字节残缺）');
  if (fffd > 0) problems.push(`U+FFFD x${fffd}`);
  if (pua > 0) problems.push(`私用区字符 x${pua}`);
  if (highConf >= 3) problems.push(`乱码字 x${highConf}`);
  if (!problems.length) return null;
  return { file: path.relative(ROOT, file), problems, fffd, pua, highConf, cjk };
}

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const targets = args.filter((a) => !a.startsWith('-'));
const roots = targets.length
  ? targets.map((t) => path.resolve(t))
  : [
      path.join(ROOT, 'server'),
      path.join(ROOT, 'client', 'src'),
      path.join(ROOT, 'skills'),
      path.join(ROOT, 'tools'),
      path.join(ROOT, 'docs'),
    ];

const files = [];
for (const r of roots) if (fs.existsSync(r)) walk(r, files);

const results = [];
for (const f of files) {
  const r = auditFile(f);
  if (r) results.push(r);
}

// 含乱码字表/工具自身的文件会自匹配，属已知误报
const SELF_SKIP = ['tools/enc-audit.mjs', 'tools/fix-text.mjs', 'tools/fixmoji.ps1'];

if (jsonOut) {
  console.log(JSON.stringify({ checked: files.length, damaged: results }, null, 2));
} else {
  if (!results.length) {
    console.log(`检查 ${files.length} 个文件：全部正常（合法 UTF-8，无乱码）。`);
  } else {
    console.log(`检查 ${files.length} 个文件，发现 ${results.length} 个异常：\n`);
    for (const r of results) {
      const known = SELF_SKIP.some((s) => r.file.split(path.sep).join('/').endsWith(s));
      console.log(`- ${r.file}${known ? '（工具自身字表，已知误报）' : ''}\n    ${r.problems.join('；')}`);
    }
    console.log('\n修复建议：');
    console.log('  GBK 文件           -> powershell -File tools/enc.ps1 Node <文件>');
    console.log('  乱码/替换符/私用区 -> 见 tools/fix-text.mjs、tools/restore-from-history.mjs（VS Code 本地历史快照）');
    console.log('  无快照的小文件     -> 直接重写（不要用编辑工具改 UTF-8 文件）');
  }
}
process.exit(results.length ? 1 : 0);
