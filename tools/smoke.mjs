// ASCII smoke test for corroborate + db + websearch multi-engine
import { corroborate, normUrl, normTitle } from '../server/sources/corroborate.js';
import { listDomains, clearDomains, bumpDomainFake, getDomainFakeHits, GREYLIST_HITS } from '../server/db.js';

console.log('normUrl  :', normUrl('https://WWW.Example.com/a?utm_source=x&b=2#frag'));
console.log('normTitle:', normTitle('Hello, AI 编程! 123'));

const items = [
  { title: 'Alpha news', url: 'https://x.com/a', source: 'bing' },
  { title: 'Alpha news', url: 'https://x.com/a?utm_source=dup', source: 'so360' },
  { title: 'Beta story', url: 'https://y.com/b', source: 'baidu' },
  { title: 'Beta story', url: 'https://z.com/b-copy', source: 'so360' },
  { title: 'Gamma only', url: 'https://w.com/g', source: 'bing' },
  { title: 'Twit hot', url: 'https://x.com/user/status/1', source: 'twitter' },
  { title: 'Twit hot', url: 'https://x.com/user/status/1', source: 'bing' },
];
corroborate(items);
for (const i of items) {
  console.log('  item', i.source.padEnd(7), i.extra.engineCount, 'srcs=' + JSON.stringify(i.extra.corroborators), i.extra.corroborated);
}
console.log('GREYLIST_HITS =', GREYLIST_HITS);
console.log('bump fake:', bumpDomainFake('https://spam.example.com/x'));
console.log('hits now :', getDomainFakeHits('https://SPAM.example.com/other'));
console.log('domains  :', JSON.stringify(listDomains().map((d) => `${d.domain}:${d.fake_hits}`)));
clearDomains();
console.log('cleared  :', listDomains().length === 0);
