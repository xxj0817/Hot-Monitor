import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'hotmonitor.db');
export const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
export const DIST_DIR = path.join(ROOT, 'client', 'dist');

export const env = {
  openrouterKey: (process.env.OPENROUTER_API_KEY || '').trim(),
  twitterKey: (process.env.TWITTER_API_KEY || '').trim(),
  port: Number(process.env.PORT || 3000),
};

const DEFAULTS = {
  pollMinutes: 30,
  // 默认免费模型：账号无余额也可用。充值后可在 UI/设置中切换为更强模型。
  model: 'nvidia/nemotron-3-super-120b-a12b:free',
  lookbackHours: 24,
  topTrends: 12,
  sourceToggles: { websearch: true, twitter: true, mock: true },
  // 网页搜索启用引擎（bing=必应, so360=360搜索, baidu=百度尽力而为）
  websearchEngines: ['bing', 'so360', 'baidu'],
  // Twitter/X 收录最低热度门槛：赞+转+评 >= 该值才收录（排除回复帖）
  twitterMinEngagement: 100,
  scope: {
    name: 'AI 编程',
    queries: ['AI 编程', '大模型', 'llm', 'coding agent', 'ai programming'],
  },
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    const b = base[k];
    const o = over[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object' && !Array.isArray(o)) {
      out[k] = deepMerge(b, o);
    } else {
      out[k] = o;
    }
  }
  return out;
}

let settings = deepMerge(DEFAULTS, {});

export function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      settings = deepMerge(DEFAULTS, raw);
    }
  } catch (e) {
    console.warn('[config] settings load failed:', e.message);
  }
  return settings;
}

export function getSettings() {
  return settings;
}

export function saveSettings(patch) {
  settings = deepMerge(settings, patch || {});
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
  return settings;
}
