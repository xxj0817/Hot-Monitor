// ASCII: verify files are valid UTF-8 with intact CJK
import fs from 'node:fs';
const files = process.argv.slice(2);
for (const f of files) {
  const b = fs.readFileSync(f);
  const s = new TextDecoder('utf-8', { fatal: true }).decode(b);
  const hasCjk = /[\u4e00-\u9fff]/.test(s);
  const bad = (s.match(/\uFFFD/g) || []).length;
  console.log((bad === 0 ? 'OK ' : 'BAD') + ' cjk=' + hasCjk + ' bad=' + bad + '  ' + f);
}
