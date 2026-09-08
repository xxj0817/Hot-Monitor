// 调度器：按 settings.pollMinutes 周期执行 关键词哨兵 + 热点雷达
import { getSettings } from './config.js';
import { scanAllKeywords } from './watcher.js';
import { refreshTrend } from './trend.js';
import { logStart, logDone, logErr, logBoot } from './log.js';

let timer = null;
let running = false;

async function cycle(kind) {
  if (running) return;
  running = true;
  const t0 = Date.now();
  const tag = kind === 'watch' ? '关键词哨兵' : kind === 'trend' ? '热点雷达' : '关键词哨兵+热点雷达';
  logStart('scheduler', `${tag} 开始 ${new Date().toISOString()}`);
  try {
    const jobs = [];
    if (!kind || kind === 'watch') jobs.push(scanAllKeywords().catch((e) => logErr('watch', e.message)));
    if (!kind || kind === 'trend') jobs.push(refreshTrend().catch((e) => logErr('trend', e.message)));
    await Promise.all(jobs);
    logDone('scheduler', `${tag} 完成 耗时=${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    logErr('scheduler', `周期异常: ${e.message}`);
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
  logBoot('scheduler', `已启动：每 ${mins} 分钟执行 关键词哨兵+热点雷达`);
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
