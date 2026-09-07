// 调度器：按 settings.pollMinutes 周期执行 关键词哨兵 + 热点雷达
import { getSettings } from './config.js';
import { scanAllKeywords } from './watcher.js';
import { refreshTrend } from './trend.js';

let timer = null;
let running = false;

async function cycle(kind) {
  if (running) return;
  running = true;
  try {
    const jobs = [];
    if (!kind || kind === 'watch') jobs.push(scanAllKeywords().catch((e) => console.error('[sched] watcher', e.message)));
    if (!kind || kind === 'trend') jobs.push(refreshTrend().catch((e) => console.error('[sched] trend', e.message)));
    await Promise.all(jobs);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  stopScheduler();
  const mins = Math.max(1, Number(getSettings().pollMinutes) || 30);
  // 启动后先跑一次，让页面尽快有数据（演示/验收友好）
  setTimeout(() => cycle().catch(() => {}), 1500);
  timer = setInterval(() => cycle().catch(() => {}), mins * 60 * 1000);
  console.log(`[scheduler] 已启动：每 ${mins} 分钟执行 关键词哨兵+热点雷达`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function restartScheduler() {
  startScheduler();
}

export function runWatchOnce() {
  return cycle('watch');
}

export function runTrendOnce() {
  return cycle('trend');
}
