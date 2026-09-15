// ASCII probe: sogou web search structure, time filter tsn=1
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
let cookie = '';
try {
  const h = await fetch('https://www.sogou.com/', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
  const sc = h.headers.get('set-cookie') || '';
  const m = sc.match(/SNUID=[^;]+/) || sc.match(/SUV=[^;]+/);
  cookie = (sc.match(/SNUID=[^;]+/) || []).join('; ');
  console.log('home status', h.status, 'cookie?', !!cookie);
} catch (e) { console.log('home ERR', e.message.slice(0, 80)); }
const H = { 'user-agent': UA, accept: 'text/html', 'accept-language': 'zh-CN,zh;q=0.9', ...(cookie ? { cookie } : {}) };
const q = encodeURIComponent('AI \u7f16\u7a0b');
const url = 'https://www.sogou.com/web?query=' + q + '&tsn=1';
const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(12000) });
const h2 = await r.text();
console.log('search status', r.status, 'len', h2.length);
const markers = {
  vrwrap: (h2.match(/class="vrwrap/g) || []).length,
  rb: (h2.match(/class="rb"/g) || []).length,
  vrTitle: (h2.match(/class="vr-title"/g) || []).length,
  h3a: (h2.match(/<h3[^>]*>[\s\S]{0,120}?<a[^>]+href="([^"]+)"/g) || []).length,
  ago: (h2.match(/(\d+\s*(\u5206\u949f|\u5c0f\u65f6|\u5929)\u524d)/g) || []).slice(0, 4),
  abs: (h2.match(/20\d{2}[-\/.\u5e74]\d{1,2}[-\/.\u6708]\d{1,2}/g) || []).slice(0, 3),
  verify: /antispider|\u9a8c\u8bc1\u7801|\u5b89\u5168\u9a8c\u8bc1/i.test(h2.slice(0, 40000)),
};
console.log(JSON.stringify(markers));
const i = h2.indexOf('class="vrwrap');
if (i > 0) console.log('BLOCK:', h2.slice(i, i + 900).replace(/\s+/g, ' '));
