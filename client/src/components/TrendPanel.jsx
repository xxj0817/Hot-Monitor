import { Icon, LevelBadge, SourceTag, HeatBar, Bracket } from './misc.jsx';
import { relTime } from '../lib/api.js';

export default function TrendPanel({ scope, trends, refreshing, onRefresh, lastRun }) {
  const top = trends.filter((t) => t && t.title);
  return (
    <section className="panel flex flex-col" aria-label="热点雷达">
      <header className="panel-head">
        <Icon.radar size={15} className="text-signal" />
        <Bracket text={`热点雷达 ${(scope?.name || 'AI 编程').slice(0, 10)}`} />
        <span className="font-mono text-[10px] text-faint">TREND-RADAR · 每轮 {trends.length} 条在榜</span>
        <button className="btn small ml-auto" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? '采集中' : '立即刷新'}
        </button>
      </header>

      {scope?.queries?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
          {scope.queries.slice(0, 6).map((q) => (
            <span key={q} className="font-mono text-[10px] text-dim">
              &gt; {q}
            </span>
          ))}
          {scope.queries.length > 6 && (
            <span className="font-mono text-[10px] text-faint">+{scope.queries.length - 6} 词</span>
          )}
        </div>
      )}

      {top.length === 0 ? (
        <div className="px-4 py-10 text-center text-[12px] leading-relaxed text-dim">
          热点榜暂无数据。
          <br />
          点击右上「<span className="font-mono text-signal">立即刷新</span>」从多信源采集并让 AI 聚合。
          <br />
          {lastRun && <span className="font-mono text-[10px] text-faint">上次批次：{lastRun}</span>}
        </div>
      ) : (
        <ol className="max-h-[52vh] overflow-y-auto">
          {top.map((t, i) => {
            const cred = t.credible === 1 ? 'good' : t.credible === null ? 'warn' : 'bad';
            return (
              <li key={t.id || t.url} className="risein group border-b border-line2 px-3 py-2 hover:bg-panel2/60">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex-none font-mono text-[20px] font-bold leading-none ${
                      i === 0 ? 'text-alert' : i < 3 ? 'text-warn' : 'text-dim'
                    }`}
                    style={{ minWidth: 22 }}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-[13.5px] font-medium text-ink hover:text-signal"
                      title={t.title}
                    >
                      {t.title}
                    </a>
                    <div className="mt-1 flex items-center gap-2">
                      <HeatBar heat={t.heat} level={t.level} />
                      <span className="flex-none font-mono text-[11px] text-signal">{t.heat}</span>
                    </div>
                    {t.summary && (
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-dim">{t.summary}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-faint">
                      <LevelBadge level={t.level} />
                      <SourceTag source={t.source} />
                      <span className="flex items-center gap-1">
                        <span className={`light ${cred}`} style={{ width: 6, height: 6 }} />
                        可信度
                      </span>
                      <span className="ml-auto">{relTime(t.updated_at || t.first_seen)}</span>
                    </div>
                  </div>
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="打开来源"
                    className="hidden flex-none text-faint hover:text-signal group-hover:block"
                  >
                    <Icon.ext size={14} />
                  </a>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
