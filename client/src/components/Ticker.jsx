// 最新情报跑马灯：滚动展示最新信号与热点
export default function Ticker({ signals, trends }) {
  const items = [];
  // 已确认信号优先（新→旧）
  for (const s of signals) {
    if (s.related === 1 && (s.authentic === 1 || s.verdict === 'demo' || s.verdict === 'authentic')) {
      items.push({ type: 'sig', text: `${s.keyword || ''}`, title: s.title, url: s.url, src: s.source });
    }
    if (items.length >= 8) break;
  }
  const seenTitles = new Set(items.map((i) => i.title));
  for (const t of trends) {
    if (t.level === 'S' || t.level === 'A') {
      if (seenTitles.has(t.title)) continue;
      seenTitles.add(t.title);
      items.push({ type: 'trend', text: `热点${t.level}`, title: t.title, url: t.url, src: t.source });
    }
    if (items.length >= 14) break;
  }
  if (items.length === 0) {
    return (
      <div className="border-y border-line bg-deck px-3 py-1.5 font-mono text-[11px] text-faint">
        &gt; 情报流待命：等待首次扫描产生信号…
      </div>
    );
  }

  const row = (i) => (
    <a
      key={`${i.type}-${i.title}-${i.url}`}
      href={i.url}
      target="_blank"
      rel="noreferrer"
      className="mx-3 inline-flex items-center gap-2 hover:text-signal"
    >
      <span className={i.type === 'sig' ? 'text-signal' : 'text-warn'}>
        {i.type === 'sig' ? '[SIG]' : '[HOT]'}
      </span>
      <span className="text-dim">{i.src}</span>
      <span className="max-w-[46vw] truncate text-ink">{i.title}</span>
    </a>
  );

  // 复制两份实现无缝循环
  const half = [...items, ...items];
  return (
    <div className="ticker-wrap overflow-hidden border-y border-line bg-deck py-1.5">
      <div className="ticker-track font-mono text-[11px]" aria-hidden="false">
        {half.map(row)}
      </div>
    </div>
  );
}
