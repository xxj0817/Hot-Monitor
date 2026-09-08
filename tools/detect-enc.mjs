// ASCII-only: detect file encoding (utf8 vs gbk) by probing Chinese round-trip
import fs from 'node:fs';
const files = process.argv.slice(2);
const gbk = { name: 'gbk' };
for (const f of files) {
  const b = fs.readFileSync(f);
  // try utf8 round trip
  const u8 = new TextDecoder('utf-8', { fatal: false });
  const s = u8.decode(b);
  const round = new TextEncoder().encode(s);
  const isUtf8 = round.length === b.length && Buffer.compare(Buffer.from(round), b) === 0;
  // try gbk decode via iconv-less approach: check contains chinese via utf8
  const hasCjk = /[\u4e00-\u9fff]/.test(s);
  console.log((isUtf8 ? 'UTF8 ' : 'GBK?') + ' cjk=' + hasCjk + '  ' + f);
}
