// ASCII probe: dump sogou organic result blocks
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const q = encodeURIComponent('AI \u7f16\u7a0b');
const r = await fetch('https://www.sogou.com/web?query=' + q + '&tsn=1', { headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'zh-CN,zh;q=0.9' }, signal: AbortSignal.timeout(12000) });
const h = await r.text();
const blocks = h.split(/<div class="vrwrap/).slice(1);
console.log('blocks:', blocks.length);
let shown = 0;
for (const b of blocks) {
  if (!/<h3/i.test(b)) continue;
  console.log('=== BLOCK ===');
  console.log(b.slice(0, 1200).replace(/\s+/g, ' '));
  if (++shown >= 2) break;
}
