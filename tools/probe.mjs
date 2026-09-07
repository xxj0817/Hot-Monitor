// ASCII-only: probe OpenRouter model(s). With an explicit model arg, test only it.
import { loadSettings, env } from '../server/config.js';
loadSettings();
const argModel = (process.argv[2] || '').trim();
const MODELS = argModel
  ? [argModel]
  : ['google/gemma-4-31b-it:free', 'minimax/minimax-m3:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'cohere/north-mini-code:free', 'z-ai/glm-5.2:free'];
const seen = new Set();
for (const m of MODELS) {
  if (seen.has(m)) continue;
  seen.add(m);
  const t0 = Date.now();
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.openrouterKey}` },
      body: JSON.stringify({
        model: m,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 12,
      }),
      signal: AbortSignal.timeout(45000),
    });
    const body = await res.text();
    let code = '';
    try { code = JSON.parse(body).error?.code || ''; } catch { /* ignore */ }
    const ms = Date.now() - t0;
    if (res.status === 200) {
      console.log(`OK    ${m}  (${ms}ms)`);
      process.exit(0);
    }
    console.log(`fail  ${m}  http=${res.status} code=${code} (${ms}ms)`);
  } catch (e) {
    console.log(`error ${m}  ${e.message.slice(0, 80)}`);
  }
  await new Promise((r) => setTimeout(r, 1200));
}
console.log('NO_OK_MODEL');
process.exit(1);
