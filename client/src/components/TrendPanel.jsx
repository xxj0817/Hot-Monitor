import { Icon, LevelBadge, SourceTag, Sect } from './misc.jsx';
import { HeatGrad } from './ui/aceternity.jsx';
import { relTime } from '../lib/api.js';

const TONE = { S: 'a', A: 'a', B: 'b', C: 'c' };

export default function TrendPanel({ scope, trends, refreshing, onRefresh, lastRun, newIds }) {
  const top = trends.filter((t) => t && t.title);
  return (
    <section className="glass dash-col flex min-h-0 flex-col overflow-hidden rounded-2xl">
      <Sect icon={Icon.flame}
        right={
          <>
            {lastRun && <span className="hidden font-mono text-[10px] text-faint sm:inline">更新于 {lastRun}</span>}
            <button className="btn small" disabled={refreshing} onClick={onRefresh}>
              {refreshing ? <span className="flex items-center gap-1"><span className="dot cy" /> 采集中</span> : <span className="flex items-center gap-1"><Icon.refresh size={12} /> 立即刷新</span>}
            </button>
          </>
        }>
        热点雷达 <span className="text-faint normal-case tracking-normal">TREND-RADAR</span>
      </Sect>

      {scope?.queries?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line-soft px-4 py-2">
          {scope.queries.slice(0, 6).map((q) => (
            <span key={q} className="rounded-full border border-line/70 px-2 py-0.5 font-mono text-[10px] text-faint">{q}</span>
          ))}
          {scope.queries.length > 6 && <span className="px-1 py-0.5 font-mono text-[10px] text-faint">+{scope.queries.length - 6}</span>}
        </div>
      )}

      {top.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-vio/25 to-cyan/15 text-vio"><Icon.radar size={26} /></span>
          <p className="font-mono text-[13px] text-dim">热点榜暂无数据</p>
          <p className="max-w-[280px] text-[12px] leading-relaxed text-faint">点「立即刷新」从多信源采集，AI 聚合后按热度排榜，大瓜第一时间置顶</p>
          <button className="btn solid mt-1" onClick={onRefresh} disabled={refreshing}>
            <span className="flex items-center gap-1.5"><Icon.zap size={13} /> {refreshing ? '采集中' : '开始扫描热点'}</span>
          </button>
        </div>
      ) : (
        <ol className="flex-1 space-y-1.5 overflow-y-auto p-3">
          {top.map((t, i) => {
            const cred = t.credible === 1 ? 'good' : t.credible === null ? 'warn' : 'bad';
            const tone = TONE[t.level] || 'c';
            const hot = i === 0;
            const demo = !t.url || String(t.url).includes('demo.hotmonitor.local');
            return (
              <li key={t.id || t.url}
                className={`group rounded-xl border p-2.5 transition-all duration-200 ${newIds && newIds[t.id] ? 'pop-in border-vio/50 bg-vio/[0.06]' : 'border-line-soft/70 bg-white/[0.015] hover:border-vio/40 hover:bg-white/[0.03]'}`}>
                <div className="flex items-center gap-3">
                  {/* 排名：前3带渐变 */}
                  <span className="w-7 flex-none text-center font-mono text-[22px] font-black leading-none">
                    {i === 0
                      ? <span className="grad-text">{String(i + 1).padStart(2, '0')}</span>
                      : <span className={i < 3 ? 'text-transparent bg-clip-text bg-linear-to-b from-vio to-cyan' : 'text-faint'}>{String(i + 1).padStart(2, '0')}</span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {demo ? (
                        <span title="演示条目：demo.hotmonitor.local 为虚构域名，无真实网页"
                          className="block min-w-0 cursor-default truncate text-[13.5px] font-semibold text-faint/85">
                          {hot ? <span className="shine">{t.title}</span> : t.title}
                          <span className="ml-1.5 rounded-md bg-white/5 px-1.5 py-px align-middle font-mono text-[9px] uppercase tracking-wider text-faint">演示</span>
                        </span>
                      ) : (
                        <a href={t.url} target="_blank" rel="noreferrer" title={t.title}
                          className="block min-w-0 truncate text-[13.5px] font-semibold text-ink transition-colors hover:text-cyan">
                          {hot ? <span className="shine">{t.title}</span> : t.title}
                        </a>
                      )}
                      {hot && <span className="flex-none rounded-full bg-rose/15 px-2 py-px font-mono text-[9px] font-bold tracking-widest text-rose">HEADLINE</span>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2.5">
                      <HeatGrad value={t.heat} tone={tone} />
                      <span className="flex-none font-mono text-[11px] font-bold text-cyan">{t.heat}</span>
                    </div>
                    {t.summary && <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-dim">{t.summary}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[10px] text-faint">
                      <LevelBadge level={t.level} />
                      <SourceTag source={t.source} />
                      <span className="inline-flex items-center gap-1.5"><span className={`dot ${cred}`} style={{ width: 6, height: 6 }} /> 可信度</span>
                      <span className="ml-auto">{relTime(t.updated_at || t.first_seen)}</span>
                    </div>
                  </div>
                  {!demo && (
                    <a href={t.url} target="_blank" rel="noreferrer" aria-label="打开来源"
                      className="hidden flex-none text-faint transition-colors hover:text-cyan group-hover:block">
                      <Icon.ext size={14} />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
