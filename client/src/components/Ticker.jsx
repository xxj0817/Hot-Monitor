// 情报快讯条：滚动播报最新信号与热点（LIVE）
export default function Ticker({ signals, trends }) {
  const items = [];
  for (const s of signals) {
    if (s.related === 1 && (s.authentic === 1 || s.verdict === 'demo' || s.verdict === 'authentic')) {
      items.push({ type: 'sig', title: s.title, url: s.url, src: s.source });
    }
    if (items.length >= 7) break;
  }
  const seen = new Set(items.map((i) => i.title));
  for (const t of trends) {
    if ((t.level === 'S' || t.level === 'A') && !seen.has(t.title)) {
      seen.add(t.title);
      items.push({ type: 'trend', title: t.title, url: t.url, src: t.source });
    }
    if (items.length >= 13) break;
  }
  if (items.length === 0) {
    return (
      <div className="border-y border-line-soft bg-panel/40 px-4 py-2 text-center font-mono text-[11px] text-faint backdrop-blur">
        <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-vio align-middle" />
        情报流待命 · 完成首次扫描后，真信号将在这里第一时间滚动
      </div>
    );
  }
  const row = (it) => {
    const demo = !it.url || String(it.url).includes('demo.hotmonitor.local');
    const cls = 'mx-4 inline-flex max-w-[60vw] items-center gap-2.5 text-[12px] hover:text-cyan';
    const tag = (
      <span className={`flex-none rounded-md px-1.5 py-px font-mono text-[9px] font-bold tracking-widest ${it.type === 'sig' ? 'bg-vio/20 text-vio' : 'bg-cyan/15 text-cyan'}`}>
        {it.type === 'sig' ? 'SIG' : 'HOT'}
      </span>
    );
    const inner = (<><span className="text-dim">{it.src}</span><span className="truncate text-ink">{it.title}</span>{demo && <span className="flex-none rounded bg-white/5 px-1 font-mono text-[8px] text-faint">演示</span>}</>);
    if (demo) {
      return (
        <span key={`${it.type}-${it.title}-${it.url}`} className={`${cls} cursor-default`} title="演示数据，无真实链接">
          {tag}{inner}
        </span>
      );
    }
    return (
      <a key={`${it.type}-${it.title}-${it.url}`} href={it.url} target="_blank" rel="noreferrer" className={cls}>
        {tag}{inner}
      </a>
    );
  };
  const doubled = [...items, ...items];
  return (
    <div className="ticker-wrap relative overflow-hidden border-y border-line-soft bg-panel/30 py-2 backdrop-blur">
      <div className="absolute inset-y-0 left-0 z-10 w-10 bg-linear-to-r from-void to-transparent" />
      <div className="absolute inset-y-0 right-0 z-10 w-10 bg-linear-to-l from-void to-transparent" />
      <div className="ticker-track">
        {doubled.map(row)}
      </div>
    </div>
  );
}
