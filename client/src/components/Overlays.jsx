import { useEffect, useState } from 'react';
import { Icon } from './misc.jsx';
import { api, fmtTime } from '../lib/api.js';
import { cn } from './ui/aceternity.jsx';

/* ---------------- Toast 容器 ---------------- */
const TOAST_STYLE = {
  signal: { cls: 'border-vio/60', icon: <Icon.zap size={13} />, iconCls: 'bg-vio/15 text-vio' },
  trend: { cls: 'border-warn/50', icon: <Icon.flame size={13} />, iconCls: 'bg-warn/15 text-warn' },
  info: { cls: 'border-cyan/50', icon: <Icon.radio size={13} />, iconCls: 'bg-cyan/15 text-cyan' },
};

export function Toasts({ toasts, onClose }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-16 z-[70] flex w-[min(360px,92vw)] flex-col gap-2.5">
      {toasts.map((t) => {
        const s = TOAST_STYLE[t.type] || TOAST_STYLE.info;
        return (
          <div key={t.id} role="status"
            className={cn('toast-in pointer-events-auto overflow-hidden rounded-2xl border bg-panel/90 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.8)] backdrop-blur-xl', s.cls)}>
            <div className="flex items-start gap-2.5 px-3.5 py-3">
              <span className={cn('mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-xl', s.iconCls)}>{s.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[11px] font-bold tracking-wide text-ink">{t.title}</p>
                {t.body && <p className="mt-0.5 line-clamp-2 text-[12px] text-dim">{t.body}</p>}
              </div>
              <button className="mt-0.5 flex-none text-faint transition-colors hover:text-ink" onClick={() => onClose(t.id)} aria-label="关闭"><Icon.x size={13} /></button>
            </div>
            {t.url && (
              <a href={t.url} target="_blank" rel="noreferrer"
                className="block border-t border-line-soft px-3.5 py-1.5 font-mono text-[10px] tracking-wide text-cyan transition-colors hover:bg-cyan/5">
                打开原文 &gt;&gt;
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- 通知中心抽屉 ---------------- */
const N_TONE = {
  'signal.new': { cls: 'bg-vio/12 text-vio', label: '信号确认', dot: 'vio' },
  'trend.new': { cls: 'bg-warn/12 text-warn', label: '新热点', dot: 'warn' },
  notice: { cls: 'bg-cyan/12 text-cyan', label: '系统', dot: 'cy' },
  'scan.done': { cls: 'bg-mint/12 text-mint', label: '扫描', dot: 'good' },
  'source.status': { cls: 'bg-white/5 text-faint', label: '信源', dot: 'idle' },
};

export function NotifDrawer({ open, notifications, unread, onClose, onRead, onReadAll }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="fade-in absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside className="slide-in-r absolute right-0 top-0 flex h-full w-[min(420px,94vw)] flex-col border-l border-line-soft bg-abyss/90 backdrop-blur-2xl" role="dialog" aria-label="通知中心">
        <header className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-linear-to-br from-vio/30 to-cyan/20 text-vio"><Icon.bell size={16} /></span>
          <div>
            <p className="font-mono text-[13px] font-bold tracking-wider text-ink">通知中心</p>
            <p className="font-mono text-[9px] tracking-widest text-faint">INTELLIGENCE INBOX</p>
          </div>
          <div className="ml-auto flex gap-2">
            <button className="btn small" onClick={onReadAll}>全部已读</button>
            <button className="btn small" onClick={onClose} aria-label="关闭通知中心"><Icon.x size={12} /></button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-3">
          {notifications.length === 0 ? (
            <div className="py-12 text-center text-[12px] text-faint">暂无通知 · 等首个真信号到来</div>
          ) : (
            notifications.map((n, i) => {
              const tone = N_TONE[n.type] || N_TONE.notice;
              const url = n.payload?.signal?.url || n.payload?.item?.url;
              return (
                <article key={n.id}
                  className={cn('pop-in mb-2 rounded-xl border p-3 transition-colors', n.read ? 'border-line-soft/60 bg-white/[0.015] opacity-65' : 'border-line/70 bg-white/[0.03]', !n.read && i < 3 && 'border-vio/40')}>
                  <div className="flex items-center gap-2">
                    <span className={cn('rounded-md px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest', tone.cls)}>{tone.label}</span>
                    <span className="ml-auto font-mono text-[10px] text-faint">{fmtTime(n.created_at)}</span>
                    {!n.read && <button className="text-faint transition-colors hover:text-mint" onClick={() => onRead(n.id)} aria-label="标记已读"><Icon.check size={12} /></button>}
                  </div>
                  <p className="mt-1.5 text-[13px] font-medium text-ink">{n.title}</p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-[11.5px] text-dim">{n.body}</p>}
                  {url && <a href={url} target="_blank" rel="noreferrer" className="mt-1.5 inline-block font-mono text-[10px] text-cyan hover:text-sky">查看来源 &gt;&gt;</a>}
                </article>
              );
            })
          )}
        </div>
        <footer className="border-t border-line-soft px-4 py-2.5 text-center font-mono text-[10px] text-faint">
          共 {notifications.length} 条 · 未读 {unread}
        </footer>
      </aside>
    </div>
  );
}

/* ---------------- 设置弹窗 ---------------- */
const ENG_OPTIONS = [['bing', '必应 Bing'], ['so360', '360 搜索'], ['baidu', '百度(尽力)']];

export function SettingsModal({ open, settings, health, onClose, onSave }) {
  const [form, setForm] = useState(null);
  const [domains, setDomains] = useState([]);

  useEffect(() => {
    if (open && settings) {
      const engs = settings.websearchEngines || ['bing', 'so360', 'baidu'];
      setForm({
        pollMinutes: settings.pollMinutes,
        model: settings.model,
        lookbackHours: settings.lookbackHours,
        topTrends: settings.topTrends,
        twitterMinEngagement: settings.twitterMinEngagement ?? 100,
        scopeName: settings.scope?.name || '',
        queries: (settings.scope?.queries || []).join('\n'),
        websearch: settings.sourceToggles?.websearch !== false,
        twitter: settings.sourceToggles?.twitter !== false,
        mock: settings.sourceToggles?.mock !== false,
        eng_bing: engs.includes('bing'),
        eng_so360: engs.includes('so360'),
        eng_baidu: engs.includes('baidu'),
      });
      api.domains().then(setDomains).catch(() => setDomains([]));
    }
  }, [open, settings]);

  if (!open || !form) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    onSave({
      pollMinutes: Number(form.pollMinutes) || 30,
      model: String(form.model).trim() || 'nvidia/nemotron-3-super-120b-a12b:free',
      lookbackHours: Number(form.lookbackHours) || 24,
      topTrends: Number(form.topTrends) || 12,
      twitterMinEngagement: Number(form.twitterMinEngagement) || 0,
      websearchEngines: ['bing', 'so360', 'baidu'].filter((k) => form['eng_' + k]),
      scope: {
        name: String(form.scopeName).trim() || 'AI 编程',
        queries: String(form.queries).split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      },
      sourceToggles: { websearch: form.websearch, twitter: form.twitter, mock: form.mock },
    });
  }

  async function clearDomains() {
    try {
      await api.clearDomains();
      setDomains([]);
    } catch { /* ignore */ }
  }

  const F = ({ label, hint, children }) => (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] font-bold tracking-wider text-dim">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] leading-relaxed text-faint">{hint}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3">
      <div className="fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="pop-in glass relative max-h-[90vh] w-[min(600px,96vw)] overflow-y-auto rounded-3xl">
        <header className="flex items-center gap-3 border-b border-line-soft px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-vio/30 to-cyan/20 text-vio"><Icon.gear size={17} /></span>
          <div>
            <p className="font-mono text-[14px] font-bold tracking-wider text-ink">系统设置</p>
            <p className="font-mono text-[9px] tracking-widest text-faint">RADAR CONFIGURATION</p>
          </div>
          <button className="btn small ml-auto" onClick={onClose} aria-label="关闭设置"><Icon.x size={12} /></button>
        </header>

        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className={cn('flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 font-mono text-[11px]', health?.ai ? 'border-mint/30 bg-mint/[0.06] text-mint' : 'border-warn/30 bg-warn/[0.06] text-warn')}>
              <span className={`dot ${health?.ai ? 'good' : 'warn'}`} /> AI {health?.ai ? '联机' : '本地降级'}
            </div>
            <div className={cn('flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 font-mono text-[11px]', health?.twitter ? 'border-cyan/30 bg-cyan/[0.06] text-cyan' : 'border-line bg-white/[0.02] text-faint')}>
              <span className={`dot ${health?.twitter ? 'cy' : 'idle'}`} /> X/Twitter {health?.twitter ? '已接入' : '未配置'}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <F label="轮询周期(分钟)"><input className="inp w-full" type="number" min="1" value={form.pollMinutes} onChange={(e) => set('pollMinutes', e.target.value)} /></F>
            <F label="回看窗口(小时)"><input className="inp w-full" type="number" min="1" value={form.lookbackHours} onChange={(e) => set('lookbackHours', e.target.value)} /></F>
            <F label="热点榜条数"><input className="inp w-full" type="number" min="3" max="50" value={form.topTrends} onChange={(e) => set('topTrends', e.target.value)} /></F>
          </div>

          <F label="OpenRouter 模型" hint="默认免费档 nvidia/nemotron-3-super-120b 零充值可用；充值后可换更强模型">
            <input className="inp w-full" value={form.model} onChange={(e) => set('model', e.target.value)} />
          </F>

          <div className="grid gap-4 sm:grid-cols-2">
            <F label="X 推文最低热度" hint="赞+转+评 之和 >= 该值才收录；回复帖一律排除。设为 0 表示不限">
              <input className="inp w-full" type="number" min="0" value={form.twitterMinEngagement}
                onChange={(e) => set('twitterMinEngagement', e.target.value)} />
            </F>
            <div>
              <span className="mb-1.5 block font-mono text-[11px] font-bold tracking-wider text-dim">网页搜索引擎</span>
              <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-ink">
                {ENG_OPTIONS.map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={form['eng_' + k]} onChange={(e) => set('eng_' + k, e.target.checked)}
                      className="h-4 w-4 rounded accent-[#8b5cf6]" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <F label="领域名称"><input className="inp w-full" value={form.scopeName} onChange={(e) => set('scopeName', e.target.value)} maxLength={20} /></F>
            <div>
              <span className="mb-1.5 block font-mono text-[11px] font-bold tracking-wider text-dim">信源开关</span>
              <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-ink">
                {[['websearch', '网页搜索'], ['twitter', 'X 推文'], ['mock', '演示源']].map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)}
                      className="h-4 w-4 rounded accent-[#8b5cf6]" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <F label="领域检索词（每行一个）" hint="多词扩大采集面，自动用于网页搜索与 X 推文">
            <textarea className="inp h-28 w-full resize-y leading-relaxed" value={form.queries} onChange={(e) => set('queries', e.target.value)} />
          </F>

          <div className="rounded-xl border border-line-soft bg-void/50 p-3.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold tracking-wider text-dim">低质域名灰名单(自动)</span>
              <span className="ml-auto font-mono text-[10px] text-faint">AI 累计判定可疑 &ge;2 次且无多源印证即自动拦截</span>
              {domains.length > 0 && (
                <button className="btn small" onClick={clearDomains} aria-label="清空灰名单">清空</button>
              )}
            </div>
            {domains.length === 0 ? (
              <p className="mt-2 font-mono text-[10.5px] text-faint">暂无灰名单记录 · AI 判定可疑的内容会自动纳入</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {domains.slice(0, 20).map((d) => (
                  <span key={d.domain}
                    className="rounded-md border border-rose/25 bg-rose/[0.07] px-2 py-0.5 font-mono text-[10px] text-rose"
                    title={`判定可疑 ${d.fake_hits} 次 · 已确认 ${d.confirmed_hits} 次`}>
                    {d.domain} <b className="opacity-80">x{d.fake_hits}</b>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-line-soft bg-void/50 px-3.5 py-2.5 font-mono text-[10px] leading-relaxed text-faint">
            API Key 存于根目录 .env（OPENROUTER_API_KEY / TWITTER_API_KEY）；缺 Key 时 AI 自动降级本地初判并标注「待核验」。
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line-soft px-5 py-4">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn solid" onClick={submit}>保存设置</button>
        </footer>
      </div>
    </div>
  );
}
