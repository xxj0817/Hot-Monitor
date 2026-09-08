// ASCII: live test bilibili source module
import { searchVideos, collectAccount, lookupAccount, isAccountKeyword } from '../server/sources/bilibili.js';
const kw = 'AI \u7f16\u7a0b';            // AI 编程
const accName = '\u4eba\u5de5\u5927\u9ed1'; // 人工大黑 (real up)
console.log('isAccountKeyword(AI 编程) =', isAccountKeyword(kw), '(expect false)');
console.log('isAccountKeyword(@foo) =', isAccountKeyword('@foo'), '(expect true)');
console.log('isAccountKeyword(OpenAI官方) =', isAccountKeyword('OpenAI\u5b98\u65b9'), '(expect true)');
const t0 = Date.now();
try {
  const vids = await searchVideos(kw, 24);
  console.log('searchVideos(' + kw + ',24h):', vids.length, 'items', Math.round((Date.now() - t0) / 1000) + 's');
  for (const v of vids.slice(0, 3)) console.log('  -', v.title.slice(0, 40), '|', v.author, '| play=' + (v.extra && v.extra.play), '|', v.publishedAt.slice(0, 10), '|', v.url);
} catch (e) { console.log('search ERR', e.message); }
try {
  const acc = await lookupAccount(accName);
  console.log('lookupAccount:', acc ? JSON.stringify({ mid: acc.mid, uname: acc.uname, fans: acc.fans, videos: acc.videos }) : 'null');
  if (acc) {
    const items = await collectAccount(acc.uname, 24 * 30);
    console.log('collectAccount videos(30d):', items.items.length);
    for (const v of items.items.slice(0, 3)) console.log('  -', v.title.slice(0, 40), '| play=' + (v.extra && v.extra.play), '|', v.publishedAt.slice(0, 10), '| account=' + !!(v.extra && v.extra.account));
  }
} catch (e) { console.log('account ERR', e.message); }
