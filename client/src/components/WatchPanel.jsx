import { useMemo, useState } from 'react';
import { api, relTime } from '../lib/api.js';
import { Icon, SigLight, VerdictBadge, SourceTag, Bracket } from './misc.jsx';

function SigRow({ sig }) {
  return (
    <div className="risein group flex items-start gap-2 border-t border-line2 px-3 py-2 first:border-t-0 hover:bg-panel2/60">
      <span className="mt-[5px] flex-none">
        <SigLight verdict={sig.verdict} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <VerdictBadge sig={sig} />
          <SourceTag source={sig.source} />
          {sig.score !== undefined && (
            <span className="font-mono text-[10px] text-faint">{sig.score}</span>
          )}
          <span className="ml-auto font-mono text-[10px] text-faint">{relTime(sig.seen_at)}</span>
        </div>
        <a
          href={sig.url}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 block text-[13px] leading-snug text-ink hover:text-signal"
        >
          {sig.title}
        </a>
        {sig.reason && (
          <p className="mt-0.5 truncate text-[11px] text-dim" title={sig.reason}>
            {sig.reason}
          </p>
        )}
      </div>
      <a href={sig.url} target="_blank" rel="noreferrer" aria-label="打开链接" className="mt-1 hidden flex-none text-faint hover:text-signal group-hover:block">
        <Icon.ext size={13} />
      </a>
    </div>
  );
}

export default function WatchPanel({ keywords, signalsByKw, busyId, onScan, onAdd, onToggle, onRemove }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [error, setError] = useState('');

  const visible = useMemo(() => keywords.filter((k) => k.enabled), [keywords]);

  async function submit() {
    const n = name.trim();
    if (!n) return;
    setAdding(true);
    setError('');
    try {
      await api.addKeyword(n);
      setName('');
      onAdd && onAdd();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="panel flex flex-col" aria-label="关键词哨兵">
      <header className="panel-head">
        <Icon.scan size={15} className="text-signal" />
        <Bracket text="关键词哨兵 KW-WATCH" />
        <span className="ml-auto font-mono text-[10px] text-faint">{visible.length} 个信号源在岗</span>
      </header>

      {/* 添加关键词 */}
      <div className="flex gap-2 border-b border-line px-3 py-2.5">
        <input
          className="inp flex-1"
          placeholder="输入要监控的关键词，回车添加，如 Claude"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="新关键词"
        />
        <button className="btn solid" disabled={adding || !name.trim()} onClick={submit} aria-label="添加关键词">
          <span className="flex items-center gap-1">
            <Icon.plus size={13} /> 添加
          </span>
        </button>
      </div>
      {error && <div className="border-b border-alert/30 bg-alert/10 px-3 py-1.5 text-[11px] text-alert">{error}</div>}

      <div className="max-h-[52vh] overflow-y-auto">
        {keywords.length === 0 && (
          <div className="px-4 py-8 text-center text-[12px] leading-relaxed text-dim">
            还没有监控关键词。
            <br />
            在上方输入一个关键词（如 <span className="font-mono text-signal">GPT-5</span>），回车后即可开始扫描与 AI 验真。
          </div>
        )}

        {keywords.map((kw) => {
          const sigs = signalsByKw[kw.name] || [];
          const busy = busyId === kw.id;
          return (
            <article key={kw.id} className={`border-b border-line2 ${kw.enabled ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-2 px-3 py-2">
                <span className={`light ${kw.enabled ? 'good blink' : 'idle'}`} />
                <h3 className="min-w-0 truncate font-mono text-[14px] font-bold tracking-wide text-ink">
                  {kw.name}
                </h3>
                <span className="font-mono text-[10px] text-faint">扫描 {relTime(kw.last_scan_at)}</span>
                <span className="ml-auto flex flex-none items-center gap-1">
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() => onScan(kw)}
                    title="立即扫描一次"
                  >
                    {busy ? '扫描中' : '扫描'}
                  </button>
                  <button
                    className="btn small"
                    onClick={() => onToggle(kw)}
                    title={kw.enabled ? '暂停' : '恢复'}
                    aria-label={kw.enabled ? '暂停监控' : '恢复监控'}
                  >
                    {kw.enabled ? <Icon.pause size={12} /> : <Icon.play size={12} />}
                  </button>
                  {confirmId === kw.id ? (
                    <button className="btn small ghost-danger" onClick={() => { onRemove(kw); setConfirmId(null); }}>
                      确认?
                    </button>
                  ) : (
                    <button className="btn small ghost-danger" onClick={() => { setConfirmId(kw.id); setTimeout(() => setConfirmId((c) => (c === kw.id ? null : c)), 2500); }} aria-label="删除关键词">
                      <Icon.trash size={12} />
                    </button>
                  )}
                </span>
              </div>

              {kw.enabled ? (
                sigs.length ? (
                  <div>
                    {sigs.slice(0, 4).map((s) => (
                      <SigRow key={s.id} sig={s} />
                    ))}
                    {sigs.length > 4 && (
                      <div className="px-3 py-1 text-right font-mono text-[10px] text-faint">
                        另有 {sigs.length - 4} 条历史信号…
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border-t border-line2 px-4 py-2 text-[11px] text-faint">
                    尚无信号。等待自动扫描或点击「扫描」触发。
                  </div>
                )
              ) : (
                <div className="border-t border-line2 px-4 py-1.5 text-[11px] text-dim">已暂停监控</div>
              )}
            </article>
          );
        })}
      </div>

      {/* 图例 */}
      <footer className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 font-mono text-[10px] text-faint">
        <span className="flex items-center gap-1.5"><span className="light good" /> 可信/演示</span>
        <span className="flex items-center gap-1.5"><span className="light warn" /> 存疑(待验证)</span>
        <span className="flex items-center gap-1.5"><span className="light bad" /> 疑似假</span>
        <span className="ml-auto">判定由 OpenRouter AI 完成</span>
      </footer>
    </section>
  );
}
