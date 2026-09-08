// ASCII: live multi-engine crawl test for one query
import { searchWeb } from '../server/sources/websearch.js';
const t0 = Date.now();
const out = await searchWeb('AI coding agent', 48);
console.log('total items:', out.length, 'elapsed', Math.round((Date.now() - t0) / 1000) + 's');
const bySrc = {};
for (const it of out) bySrc[it.source] = (bySrc[it.source] || 0) + 1;
console.log('by source :', JSON.stringify(bySrc));
for (const it of out.slice(0, 6)) console.log('  -', it.source, '|', it.title.slice(0, 60), '|', it.url.slice(0, 90));
