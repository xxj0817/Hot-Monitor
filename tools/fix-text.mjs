// 文本修复工具：把被“编辑工具按 GBK 回写”而损坏的中文行按行号还原，并扫描仓库里的乱码残留。
//
// 用法：
//   node tools/fix-text.mjs --scan src-dir ...            # 扫描乱码残留（只报告）
//   node tools/fix-text.mjs --fix api                      # 按内置映射修复已知文件
//
// 说明：映射用“行号 + 该行预期包含的 ASCII 片段”双重校验，避免误改。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 常见“UTF-8 中文被按 GBK 解码”后的特征字（只收录正常文本里几乎不会出现的字，避免误报）
const MOJI = new Set(
  '鍏敭璇氳繑洖瘡叧閿瘝湰湴彉浣撳粡熸垚鍒锋柊鍗曚釜敓骞剁紦瀛榪櫎缂瓨笅娆壂鎻忛噸㈠純缁熻鐪嬮椄闂埌搴曟嫤淇彿鐑偣閫氱煡璁剧疆鍛ㄦ湡闇閲嶅惎璋冨害鎵嬪姩浠诲姟浜嬩欢娴鐢熸垚'.split('')
);

function scan(targets) {
  const files = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) {
        if (['node_modules', 'dist', '.git', 'data', '.vite'].includes(name)) continue;
        walk(path.join(p, name));
      }
    } else if (/\.(js|jsx|mjs|cjs|json|jsonl|md|ps1|css|html|txt)$/.test(p)) {
      files.push(p);
    }
  };
  for (const t of targets) {
    const abs = path.isAbsolute(t) ? t : path.join(ROOT, t);
    if (fs.existsSync(abs)) walk(abs);
  }
  let bad = 0;
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    let hits = 0;
    for (const ch of txt) if (MOJI.has(ch)) hits++;
    if (hits > 2) {
      bad++;
      const rel = path.relative(ROOT, f);
      console.log(`MOJI ${rel} hits=${hits}`);
      const lines = txt.split('\n');
      lines.forEach((l, i) => {
        let h = 0;
        for (const ch of l) if (MOJI.has(ch)) h++;
        if (h >= 2) console.log(`     L${i + 1}: ${l.trim().slice(0, 90)}`);
      });
    }
  }
  console.log(`\n扫描 ${files.length} 个文件，命中 ${bad} 个`);
  return bad;
}

// 行号 -> 正确文本（不含行首缩进，缩进保留原样）
const MAP = {
  'server/api.js': {
    31: { anchor: '// ----------', text: '// ---------- 汇总状态 ----------' },
    55: { anchor: '// ----------', text: '// ---------- 关键词 ----------' },
    60: { anchor: 'res.status(400)', text: "if (!name) return res.status(400).json({ error: '关键词不能为空' });" },
    67: { anchor: 'UNIQUE', text: "if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '关键词已存在' });" },
    85: { anchor: 'res.status(400)', text: "if (!name) return res.status(400).json({ error: '关键词不能为空' });" },
    89: { anchor: 'UNIQUE', text: "if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '关键词已存在' });" },
    107: { anchor: '// ----------', text: '// ---------- 查询扩展 ----------' },
    108: { anchor: 'AI', text: '// 列表：返回每个关键词的本地变体 + AI 变体（AI 变体需已经生成过）' },
    118: { anchor: 'AI', text: '// 生成/刷新：对单个关键词生成 AI 扩展变体并缓存' },
    137: { anchor: '// ', text: '// 删除缓存（下次扫描重新生成）' },
    144: { anchor: '// ', text: '// 丢弃统计：看看闸门到底拦下了什么' },
    154: { anchor: '// ----------', text: '// ---------- 信号 ----------' },
    162: { anchor: '// ----------', text: '// ---------- 热点 ----------' },
    174: { anchor: '// ----------', text: '// ---------- 通知 ----------' },
    191: { anchor: '// ----------', text: '// ---------- 设置 ----------' },
    258: { anchor: '// ', text: '// 周期变化需重启调度' },
    264: { anchor: '// ----------', text: '// ---------- 信号 ----------' },
    280: { anchor: '// ----------', text: '// ---------- 热点 ----------' },
    290: { anchor: '// ----------', text: '// ---------- 手动任务 ----------' },
    301: { anchor: 'SSE', text: '// ---------- SSE 事件流 ----------' },
  },
  'client/src/lib/api.js': {
    1: { anchor: 'API', text: '// 前端 API 客户端' },
    46: { anchor: 'SSE', text: '// 订阅 SSE 事件：返回取消函数' },
    77: { anchor: '// ', text: '// 相对时间格式化（中文）' },
  },
};

function fix(name) {
  const rel = name.includes('.') ? name : '';
  const targets = rel ? { [rel]: MAP[rel] } : MAP;
  for (const file of Object.keys(targets)) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) {
      console.log(`SKIP ${file}（不存在）`);
      continue;
    }
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    let n = 0;
    for (const key of Object.keys(targets[file])) {
      const idx = Number(key) - 1;
      const rule = targets[file][key];
      const cur = lines[idx];
      if (cur === undefined) continue;
      if (rule.anchor && !cur.includes(rule.anchor)) {
        console.log(`SKIP ${file}:${key}（锚点不匹配：${rule.anchor}）`);
        continue;
      }
      const indent = (cur.match(/^\s*/) || [''])[0];
      const next = indent + rule.text;
      if (cur !== next) {
        lines[idx] = next;
        n++;
      }
    }
    fs.writeFileSync(abs, lines.join('\n'), 'utf8');
    console.log(`FIXED ${file}: ${n} 行`);
  }
}

const args = process.argv.slice(2);
if (args.includes('--scan')) {
  const idx = args.indexOf('--scan');
  const dirs = args.slice(idx + 1).filter((a) => !a.startsWith('--'));
  scan(dirs.length ? dirs : ['server', 'client', 'tools']);
} else if (args.includes('--fix')) {
  const idx = args.indexOf('--fix');
  const names = args.slice(idx + 1).filter((a) => !a.startsWith('--'));
  if (names.length) for (const n of names) fix(n);
  else fix('');
} else {
  console.log('用法：node tools/fix-text.mjs --scan [dir...] | --fix [file...]');
}
