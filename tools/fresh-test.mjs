// ASCII: verify freshness/evergreen pipeline
import { searchWeb } from '../server/sources/websearch.js';
import { looksEvergreen } from '../server/sources/corroborate.js';

const samples = [
  { title: 'OpenAI \u5b98\u7f51', url: 'https://openai.com/' },
  { title: '\u4ec0\u4e48\u662f\u5927\u6a21\u578b\uff08LLMs\uff09\uff1f\u4e00\u6587\u8bfb\u61c2 - \u77e5\u4e4e', url: 'https://www.zhihu.com/question/591009674' },
  { title: 'AI \u5de5\u5177\u96c6', url: 'https://ai-bot.cn/' },
  { title: 'Claude 4.5 \u53d1\u5e03\uff0c\u7f16\u7801\u80fd\u529b\u63d0\u5347', url: 'https://www.anthropic.com/news/claude-4-5' },
  { title: '\u817e\u8baf\u5f00\u6e90\u65b0\u6a21\u578b Youtu', url: 'https://github.com/Tencent/Youtu' },
];
for (const s of samples) {
  console.log(looksEvergreen(s) ? 'EVERGREEN ' : 'news      ', s.title.slice(0, 30), s.url.slice(0, 40));
}

const list = await searchWeb('AI \u7f16\u7a0b', 24);
console.log('\nsearchWeb items:', list.length);
let known = 0, evg = 0;
for (const it of list) {
  const tsK = !(it.extra && it.extra.tsKnown === false);
  if (tsK) known++;
  if (it.extra && it.extra.evergreen) evg++;
  console.log(' ', it.source.padEnd(6), 'tsKnown=' + tsK, 'evergreen=' + !!(it.extra && it.extra.evergreen), (it.extra && it.extra.tsKnown ? it.publishedAt.slice(0, 10) : '----'), it.title.slice(0, 34));
}
console.log('known-time:', known, 'evergreen:', evg);
