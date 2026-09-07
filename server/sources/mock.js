// 演示信源：无任何外部依赖，生成与关键词/领域相关的样例条目。
// URL 对同一关键词/索引稳定 => 天然去重，不会重复刷屏；随运行时间推进展示"新信号"。
import { norm, withinLookback } from './base.js';

const PHRASES = [
  '官方发布技术博客，披露了架构与性能细节，社区讨论热烈',
  '发布重要更新，多家媒体第一时间报道，支持新能力',
  '迎来大版本升级，开发者社区出现大量实战教程与评测',
  '官方演示引发热议，网友开始逐条分析其中的新特性',
  '团队回应社区关切，公布了后续路线图与时间表',
];

function safeKw(kw) {
  return String(kw || 'kw').replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 40);
}

export async function collectByKeyword(keyword, lookbackHours = 24) {
  const kw = String(keyword || '');
  const nowMs = Date.now();
  const items = [];
  for (let i = 0; i < 5; i++) {
    const publishedAt = new Date(nowMs - (10 + i * 55) * 60 * 1000).toISOString();
    const item = norm({
      title: `${kw} ${PHRASES[i]}`,
      url: `https://demo.hotmonitor.local/kw/${safeKw(kw)}/${i + 1}`,
      summary: `【演示数据】关于「${kw}」的最新动态示例，用于无外网/无 Key 时演示完整链路。本条为主题 ${i + 1}。`,
      author: 'demo-bot',
      source: 'mock',
      publishedAt,
    });
    if (item && withinLookback(item, lookbackHours)) items.push(item);
  }
  return items;
}

export async function collectByQuery(query, lookbackHours = 24) {
  const q = String(query || '');
  const nowMs = Date.now();
  const items = [];
  for (let i = 0; i < 4; i++) {
    const publishedAt = new Date(nowMs - (8 + i * 70) * 60 * 1000).toISOString();
    const item = norm({
      title: `【演示】${q} 领域热点 ${i + 1}：${PHRASES[(i + 1) % PHRASES.length]}`,
      url: `https://demo.hotmonitor.local/scope/${safeKw(q)}/${i + 1}`,
      summary: `【演示数据】领域「${q}」的最新热点条目示例，用于演示热点雷达完整链路。`,
      author: 'demo-bot',
      source: 'mock',
      publishedAt,
    });
    if (item && withinLookback(item, lookbackHours)) items.push(item);
  }
  return items;
}
