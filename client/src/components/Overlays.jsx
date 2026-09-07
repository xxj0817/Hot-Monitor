import { useEffect, useState } from 'react';
import { Icon, Bracket, SigLight } from './misc.jsx';
import { fmtTime } from '../lib/api.js';

/* ---------------- Toast 容器 ---------------- */
export function Toasts({ toasts, onClose }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[70] flex w-[min(360px,92vw)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast pointer-events-auto border bg-panel shadow-[0_6px_24px_rgba(0,0,0,0.5)] ${
            t.type === 'signal'
              ? 'border-signal/60'
              : t.type === 'trend'
              ? 'border-warn/60'
              : 'border-line'
          }`}
          role="status"
        >
          <div className="flex items-start gap-2 px-3 py-2.5">
            <span className="mt-1 flex-none">
              {t.type === 'signal' ? (
                <SigLight verdict="authentic" />
              ) : t.type === 'trend' ? (
                <span className="light warn" />
              ) : (
                <span className="light idle" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] font-bold tracking-wide text-signal">{t.title}</p>
              {t.body && (
                <p className="mt-0.5 line-clamp-2 text-[12px] text-ink">{t.body}</p>
              )}
            </div>
            <button className="mt-0.5 flex-none text-faint hover:text-ink" onClick={() => onClose(t.id)} aria-label="关闭">
              <Icon.x size={13} />
            </button>
          </div>
          {t.url && (
            <a
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="block border-t border-line px-3 py-1 font-mono text-[10px] tracking-wide text-info hover:text-signal"
            >
              打开原文 &gt;&gt;
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- 通知中心抽屉 ---------------- */
const TYPE_TONE = {
  'signal.new': { label: '信号确认', cls: 'text-signal' },
  'trend.new': { label: '热点', cls: 'text-warn' },
  notice: { label: '系统', cls: 'text-info' },
  'scan.done': { label: '扫描', cls: 'text-info' },
  'source.status': { label: '信源', cls: 'text-dim' },
};

export function NotifDrawer({ open, notifications, unread, onClose, onRead, onReadAll }) {
  useEffect(() => {
    function esc(e) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="fadein absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <aside
        className="drawer absolute right-0 top-0 flex h-full w-[min(400px,94vw)] flex-col border-l border-line bg-deck"
        role="dialog"
        aria-label="通知中心"
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Icon.bell size={15} className="text-signal" />
          <Bracket text="通知中心 INBOX" />
          <button className="btn small ml-auto" onClick={onReadAll}>
            全部已读
          </button>
          <button className="btn small" onClick={onClose} aria-label="关闭通知中心">
            <Icon.x size={12} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] text-dim">暂无通知</div>
          ) : (
            notifications.map((n) => {
              const tone = TYPE_TONE[n.type] || TYPE_TONE.notice;
              const url = n.payload?.signal?.url || n.payload?.item?.url;
              return (
                <article
                  key={n.id}
                  className={`border-b border-line2 px-4 py-2.5 ${n.read ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[10px] font-bold tracking-widest ${tone.cls}`}>
                      [{tone.label}]
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-faint">{fmtTime(n.created_at)}</span>
                    {!n.read && (
                      <button className="text-faint hover:text-signal" onClick={() => onRead(n.id)} aria-label="标记已读">
                        <Icon.check size={12} />
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 text-[13px] font-medium text-ink">{n.title}</p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-[11.5px] text-dim">{n.body}</p>}
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block font-mono text-[10px] text-info hover:text-signal"
                    >
                      查看来源 &gt;&gt;
                    </a>
                  )}
                </article>
              );
            })
          )}
        </div>
        <footer className="border-t border-line px-4 py-2 font-mono text-[10px] text-faint">
          共 {notifications.length} 条 · 未读 {unread}
        </footer>
      </aside>
    </div>
  );
}

/* ---------------- 设置弹窗 ---------------- */
export function SettingsModal({ open, settings, health, meta, onClose, onSave }) {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (open && settings) {
      setForm({
        pollMinutes: settings.pollMinutes,
        model: settings.model,
        lookbackHours: settings.lookbackHours,
        topTrends: settings.topTrends,
        scopeName: settings.scope?.name || '',
        queries: (settings.scope?.queries || []).join('\n'),
        websearch: settings.sourceToggles?.websearch !== false,
        twitter: settings.sourceToggles?.twitter !== false,
        mock: settings.sourceToggles?.mock !== false,
      });
    }
  }, [open, settings]);

  if (!open || !form) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    onSave({
      pollMinutes: Number(form.pollMinutes) || 30,
      model: String(form.model).trim() || 'minimax/minimax-m3:free',
      lookbackHours: Number(form.lookbackHours) || 24,
      topTrends: Number(form.topTrends) || 12,
      scope: {
        name: String(form.scopeName).trim() || 'AI 编程',
        queries: String(form.queries)
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      },
      sourceToggles: { websearch: form.websearch, twitter: form.twitter, mock: form.mock },
    });
  }

  const F = ({ label, children, hint }) => (
    <label className="block">
      <span className="mb-1 block font-mono text-[11px] font-bold tracking-wider text-dim">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] text-faint">{hint}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3">
      <div className="fadein absolute inset-0 bg-black/65" onClick={onClose} aria-hidden="true" />
      <div className="panel cut-corner relative w-[min(560px,96vw)] max-h-[90vh] overflow-y-auto" role="dialog" aria-label="设置">
        <header className="panel-head sticky top-0 z-10">
          <Icon.gear size={15} className="text-signal" />
          <Bracket text="系统设置 CONFIG" />
          <button className="btn small ml-auto" onClick={onClose} aria-label="关闭设置">
            <Icon.x size={12} />
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          {/* Key 状态 */}
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
            <div className="flex items-center gap-2 border border-line px-3 py-2">
              <span className={`light ${health?.ai ? 'good' : 'warn'}`} />
              <span>AI: {health?.ai ? `联机 ${settings.model}` : '本地降级'}</span>
            </div>
            <div className="flex items-center gap-2 border border-line px-3 py-2">
              <span className={`light ${health?.twitter ? 'good' : 'idle'}`} />
              <span>X/Twitter: {health?.twitter ? '已接入' : '未配置'}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <F label="轮询周期（分钟）">
              <input className="inp w-full" type="number" min="1" value={form.pollMinutes} onChange={(e) => set('pollMinutes', e.target.value)} />
            </F>
            <F label="回看窗口（小时）">
              <input className="inp w-full" type="number" min="1" value={form.lookbackHours} onChange={(e) => set('lookbackHours', e.target.value)} />
            </F>
            <F label="热点榜条数">
              <input className="inp w-full" type="number" min="3" max="50" value={form.topTrends} onChange={(e) => set('topTrends', e.target.value)} />
            </F>
          </div>

          <F label="OpenRouter 模型" hint="免费档 minimax/minimax-m3:free 零充值可用；充值后可换更强模型">
            <input className="inp w-full" value={form.model} onChange={(e) => set('model', e.target.value)} />
          </F>

          <div className="grid grid-cols-2 gap-3">
            <F label="领域名称">
              <input className="inp w-full" value={form.scopeName} onChange={(e) => set('scopeName', e.target.value)} maxLength={20} />
            </F>
            <F label="信源开关">
              <div className="flex h-[34px] items-center gap-3 font-mono text-[11px] text-ink">
                {[
                  ['websearch', '网页搜索'],
                  ['twitter', 'X 推文'],
                  ['mock', '演示源'],
                ].map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center gap-1.5">
                    <input type="checkbox" className="accent-[#2ee6a8]" checked={form[k]} onChange={(e) => set(k, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
            </F>
          </div>

          <F label="领域检索词（每行一个，中英文皆可）" hint="多词扩大采集面；自动用于网页搜索与 X 推文">
            <textarea
              className="inp h-28 w-full resize-y leading-relaxed"
              value={form.queries}
              onChange={(e) => set('queries', e.target.value)}
            />
          </F>

          <p className="border border-line bg-void px-3 py-2 font-mono text-[10.5px] leading-relaxed text-dim">
            API Key 存放于项目根目录 .env：OPENROUTER_API_KEY / TWITTER_API_KEY。
            缺 Key 时 AI 降级本地初判（结果标「存疑」），Twitter 信源自动禁用。
          </p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn solid" onClick={submit}>保存设置</button>
        </footer>
      </div>
    </div>
  );
}
