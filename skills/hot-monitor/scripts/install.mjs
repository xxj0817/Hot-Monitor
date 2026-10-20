// 一键安装：把本技能复制到 AI 助手能自动发现的技能目录
//
// 用法：
//   node scripts/install.mjs                     # 装到当前工作区 .agents/skills/hot-monitor
//   node scripts/install.mjs --user              # 装到用户级 ~/.agents/skills/hot-monitor
//   node scripts/install.mjs --claude            # 装到 ~/.claude/skills/hot-monitor
//   node scripts/install.mjs --target <目录>      # 装到指定目录（该目录下会创建 hot-monitor/）
//   node scripts/install.mjs --workspace <路径>   # 指定工作区根目录（默认当前目录）
//
// 纯标准库实现，跨平台（Windows / macOS / Linux）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_SRC = path.resolve(__dirname, '..');
const SKILL_NAME = 'hot-monitor';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, dflt) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('-') ? args[i + 1] : dflt;
};

function targetDir() {
  const explicit = opt('--target', '');
  if (explicit) return path.resolve(explicit);
  if (flag('--user')) return path.join(os.homedir(), '.agents', 'skills');
  if (flag('--claude')) return path.join(os.homedir(), '.claude', 'skills');
  if (flag('--copilot')) return path.join(os.homedir(), '.copilot', 'skills');
  const ws = path.resolve(opt('--workspace', process.cwd()));
  return path.join(ws, '.agents', 'skills');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

const root = targetDir();
const dest = path.join(root, SKILL_NAME);
if (path.resolve(dest) === path.resolve(SKILL_SRC)) {
  console.log('技能已在目标位置，无需复制。');
  process.exit(0);
}
copyDir(SKILL_SRC, dest);

console.log(`已安装技能到：${dest}`);
console.log('');
console.log('验证：');
console.log(`  node "${path.join(dest, 'scripts', 'hot-monitor.mjs')}" status`);
console.log('');
console.log('发现路径参考（把技能放进去，AI 助手即可自动加载）：');
console.log('  工作区级：<项目>/.agents/skills/ 或 <项目>/.github/skills/ 或 <项目>/.claude/skills/');
console.log('  用户级：  ~/.agents/skills/ 或 ~/.claude/skills/ 或 ~/.copilot/skills/');
