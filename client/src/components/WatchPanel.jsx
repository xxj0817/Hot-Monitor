import { useMemo, useState } from 'react';
import { api, relTime } from '../lib/api.js';
import { Icon, SigLight, VerdictBadge, SourceTag, Legend, Sect } from './misc.jsx';
import { GlowCard } from './ui/aceternity.jsx';

function SigRow({ sig, fresh }) {
  const demo = !sig.url || String(sig.url).includes('demo.hotmonitor.local');
  return (
    <div className={`${fresh ? 'pop-in' : ''} group flex items-start gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-white/[0.035]`}>
      <span className="mt-1.5 flex-none"><SigLight verdict={sig.verdict} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <VerdictBadge sig={sig} />
          <SourceTag source={sig.source} />
          <span className="font-mono text-[10px] text-faint">{relTime(sig.seen_at)}</span>
          <span className="ml-auto font-mono text-[10px] text-faint">AI {sig.score ?? '·'}</span>
        </div>
        {demo ? (
          <span className="mt-0.5 block cursor-default text-[13px] font-medium leading-snug text-faint/80"
            title="演示数据：域名 demo.hotmonitor.local 为虚构，仅供无外网演示，无真实网页">
            {sig.title}
            <span className="ml-1.5 rounded-md bg-white/5 px-1.5 py-px align-middle font-mono text-[9px] uppercase tracking-wider text-faint">演示 · 无链接</span>
          </span>
        ) : (
          <a href={sig.url} target="_blank" rel="noreferrer"
            className="mt-0.5 block text-[13px] font-medium leading-snug text-ink transition-colors hover:text-cyan">
            {sig.title}
          </a>
        )}
        {sig.reason && <p className="mt-0.5 line-clamp-1 text-[11px] text-faint" title={sig.reason}>{sig.reason}</p>}
      </div>
      {!demo && (
        <a href={sig.url} target="_blank" rel="noreferrer" aria-label="打开链接"
          className="mt-1 hidden flex-none text-faint transition-colors hover:text-vio group-hover:block">
          <Icon.ext size={13} />
        </a>
      )}
    </div>
  );
}

export default function WatchPanel({ keywords, signalsByKw, busyId, onScan, onAdd, onToggle, onRemove, lastSeen }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [error, setError] = useState('');

  const active = useMemo(() => keywords.filter((k) => k.enabled).length, [keywords]);

  async function submit() {
    const n = name.trim();
    if (!n) return;
    setAdding(true); setError('');
    try { await api.addKeyword(n); setName(''); onAdd && onAdd(); }
    catch (e) { setError(e.message); }
    finally { setAdding(false); }
  }

  return (
    <section className="glass dash-col flex min-h-0 flex-col overflow-hidden rounded-2xl">
      <Sect icon={Icon.scan} right={<span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-dim">{active} 在岗</span>}>
        关键词哨兵 <span className="text-faint normal-case tracking-normal">KW-WATCH</span>
      </Sect>

      <div className="flex gap-2 p-3">
        <input className="inp flex-1" placeholder="输入想盯的关键词，如 Claude / Gemini / Sora…"
          value={name} maxLength={40} aria-label="新关键词"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <button className="btn solid" disabled={adding || !name.trim()} onClick={submit} aria-label="添加关键词">
          <span className="flex items-center gap-1.5"><Icon.plus size={13} /> 添加</span>
        </button>
      </div>
      {error && <div className="mx-3 mb-2 rounded-lg border border-rose/30 bg-rose/10 px-3 py-1.5 text-[11px] text-rose">{error}</div>}

      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {keywords.length === 0 && (
          <div className="py-10 text-center">
            <p className="font-mono text-[13px] text-dim">还没有监控关键词</p>
            <p className="mx-auto mt-1 max-w-[260px] text-[12px] leading-relaxed text-faint">
              输入一个大模型 / 产品的名字，一旦出现<b className="text-vio">真实可信</b>的新动态，第一时间弹给你
            </p>
          </div>
        )}

        {keywords.map((kw, idx) => {
          const sigs = signalsByKw[kw.name] || [];
          const busy = busyId === kw.id;
          const freshIds = lastSeen || {};
          return (
            <GlowCard key={kw.id}
              className={`rounded-xl border transition-colors ${kw.enabled ? 'border-line-soft bg-white/[0.02] hover:border-vio/40' : 'border-line-soft/60 bg-transparent opacity-60'}`}
              color="rgba(139, 92, 246, 0.08)">
              <div className="flex items-center gap-2.5 px-3 pt-2.5">
                <span className={`dot ${kw.enabled ? 'good' : 'idle'}`} />
                <h3 className="min-w-0 truncate font-mono text-[14px] font-bold tracking-wide text-ink">{kw.name}</h3>
                <span className="font-mono text-[10px] text-faint">扫描 {relTime(kw.last_scan_at)}</span>
                <span className="ml-auto flex flex-none items-center gap-1.5">
                  <button className="btn small" disabled={busy} onClick={() => onScan(kw)} title="立即扫描一次">
                    {busy ? <span className="flex items-center gap-1"><span className="dot vio" /> 扫描中</span> : <span className="flex items-center gap-1"><Icon.zap size={11} /> 扫描</span>}
                  </button>
                  <button className="btn small" onClick={() => onToggle(kw)} aria-label={kw.enabled ? '暂停监控' : '恢复监控'}>
                    {kw.enabled ? <Icon.pause size={12} /> : <Icon.play size={12} />}
                  </button>
                  {confirmId === kw.id ? (
                    <button className="btn small danger" onClick={() => { onRemove(kw); setConfirmId(null); }}>确认?</button>
                  ) : (
                    <button className="btn small danger" onClick={() => { setConfirmId(kw.id); setTimeout(() => setConfirmId((c) => (c === kw.id ? null : c)), 2500); }} aria-label="删除关键词">
                      <Icon.trash size={12} />
                    </button>
                  )}
                </span>
              </div>

              <div className="mt-1 px-1 pb-2">
                {!kw.enabled ? (
                  <div className="px-3 pb-1 text-[11px] text-faint">已暂停监控</div>
                ) : sigs.length === 0 ? (
                  <div className="px-3 pb-1 text-[11px] text-faint">暂无信号 · 等自动扫描或点「扫描」立即触发</div>
                ) : (
                  <div>
                    {sigs.slice(0, 4).map((s) => <SigRow key={s.id} sig={s} fresh={idx < 3 && freshIds[s.id]} />)}
                    {sigs.length > 4 && (
                      <div className="px-3 pt-1 text-right font-mono text-[10px] text-faint">另有 {sigs.length - 4} 条历史信号</div>
                    )}
                  </div>
                )}
              </div>
            </GlowCard>
          );
        })}
      </div>

      <footer className="border-t border-line-soft px-4 py-2">
        <Legend items={[['good', '已确认'], ['warn', '待核验'], ['bad', '疑似假'], ['idle', '无关']]} />
      </footer>
    </section>
  );
}
