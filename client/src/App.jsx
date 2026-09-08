import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useEventStream, fmtTime } from './lib/api.js';
import { Icon } from './components/misc.jsx';
import { AuroraField, GlowCard, RadarLogo } from './components/ui/aceternity.jsx';
import Ticker from './components/Ticker.jsx';
import WatchPanel from './components/WatchPanel.jsx';
import TrendPanel from './components/TrendPanel.jsx';
import { Toasts, NotifDrawer, SettingsModal } from './components/Overlays.jsx';

const EMPTY = {
  keywords: [], signals: [], trends: [], notifications: [],
  sources: [], trendRuns: [], settings: null,
  health: { ai: false, twitter: false },
};

export default function App() {
  const [data, setData] = useState(EMPTY);
  const [notifOpen, setNotifOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanId, setScanId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [flash, setFlash] = useState({});
  const [desktopOk, setDesktopOk] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );
  const refreshTimer = useRef(null);

  const refresh = useCallback(async () => {
    try { setData(await api.state()); } catch (e) { console.error('state fetch failed', e.message); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [refresh]);

  const addToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts.slice(-3), { ...toast, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 9000);
  }, []);
  const closeToast = useCallback((id) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  const flashId = useCallback((kind, id) => {
    if (id == null) return;
    const key = `${kind}:${id}`;
    setFlash((f) => ({ ...f, [key]: Date.now() }));
    setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[key]; return n; }), 12000);
  }, []);

  const desktopNotify = useCallback((title, body, url) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(`HOT//MONITOR · ${title}`, { body, tag: url });
      if (url) n.onclick = () => { window.open(url, '_blank'); n.close(); };
    } catch { /* ignore */ }
  }, []);

  const debouncedRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 350);
  }, [refresh]);

  // SSE：真信号第一时间落地
  const onEvent = useCallback((type, d) => {
    if (type === 'signal.new') {
      const sig = d.signal;
      if (sig) {
        flashId('sig', sig.id);
        addToast({ type: 'signal', title: `信号确认【${d.keyword}】`, body: sig.title, url: sig.url });
        desktopNotify(d.keyword, sig.title, sig.url);
      }
      debouncedRefresh();
    } else if (type === 'trend.new') {
      const it = d.item;
      if (it) {
        flashId('tr', it.id);
        if (it.level === 'S' || it.level === 'A') addToast({ type: 'trend', title: `新热点 [${it.level}]`, body: it.title, url: it.url });
      }
      debouncedRefresh();
    } else if (type === 'notice') {
      if (d.type === 'notice') addToast({ type: 'info', title: d.title, body: d.body });
      debouncedRefresh();
    } else if (type === 'scan.done') {
      debouncedRefresh();
    }
  }, [addToast, desktopNotify, debouncedRefresh, flashId]);

  useEffect(() => useEventStream(onEvent), [onEvent]);

  // ---- 操作 ----
  const scanKeyword = async (kw) => {
    setScanId(kw.id);
    try {
      const r = await api.scanKeyword(kw.id);
      if (r.confirmed > 0 || r.added > 0) addToast({ type: 'info', title: `扫描完成【${kw.name}】`, body: `候选 ${r.candidates} · 新信号 ${r.added} · 确认 ${r.confirmed}` });
      await refresh();
    } catch (e) { addToast({ type: 'info', title: `扫描失败【${kw.name}】`, body: e.message }); }
    finally { setScanId(null); }
  };
  const runWatchAll = async () => {
    try {
      const r = await api.runWatch();
      addToast({ type: 'info', title: '哨兵全员扫描', body: `新增 ${(r.results || []).reduce((a, x) => a + (x.added || 0), 0)} 条信号` });
      await refresh();
    } catch (e) { addToast({ type: 'info', title: '扫描失败', body: e.message }); }
  };
  const refreshTrends = async () => {
    setRefreshing(true);
    try {
      const r = await api.refreshTrends();
      addToast({ type: 'info', title: '热点雷达刷新', body: `采集 ${r.candidates} · 上榜 ${r.kept} · 新增 ${r.added}` });
      await refresh();
    } catch (e) { addToast({ type: 'info', title: '热点刷新失败', body: e.message }); }
    finally { setRefreshing(false); }
  };
  const saveSettings = async (patch) => {
    try { await api.saveSettings(patch); addToast({ type: 'info', title: '设置已保存', body: '参数已生效' }); setSettingsOpen(false); await refresh(); }
    catch (e) { addToast({ type: 'info', title: '保存失败', body: e.message }); }
  };
  const requestDesktop = async () => {
    if (typeof Notification === 'undefined') { addToast({ type: 'info', title: '浏览器不支持桌面通知', body: '建议使用 Chrome / Edge' }); return; }
    if (desktopOk) { setDesktopOk(false); return; }
    try {
      const p = await Notification.requestPermission();
      setDesktopOk(p === 'granted');
      addToast({ type: 'info', title: p === 'granted' ? '桌面提醒已开启' : '未获得授权', body: p === 'granted' ? '后台也能收到真信号弹窗' : '可在浏览器地址栏重新授权' });
    } catch { /* ignore */ }
  };
  const toggleKeyword = async (kw) => { await api.patchKeyword(kw.id, { enabled: kw.enabled ? 0 : 1 }); refresh(); };
  const removeKeyword = async (kw) => { await api.delKeyword(kw.id); refresh(); };
  const markRead = async (id) => { await api.markRead(id); refresh(); };
  const readAll = async () => { await api.readAll(); refresh(); };

  // ---- 派生数据 ----
  const signalsByKw = useMemo(() => {
    const m = {};
    for (const s of data.signals) (m[s.keyword || '?'] = m[s.keyword || '?'] || []).push(s);
    return m;
  }, [data.signals]);

  const freshSigIds = useMemo(() => {
    const o = {};
    for (const k of Object.keys(flash)) if (k.startsWith('sig:')) o[k.slice(4)] = 1;
    return o;
  }, [flash]);
  const freshTrendIds = useMemo(() => {
    const o = {};
    for (const k of Object.keys(flash)) if (k.startsWith('tr:')) o[k.slice(3)] = 1;
    return o;
  }, [flash]);

  const unread = useMemo(() => data.notifications.filter((n) => !n.read).length, [data.notifications]);
  const s = data.settings;
  const lastRun = data.trendRuns?.[0];
  const toggles = s?.sourceToggles || {};

  return (
    <div className="relative min-h-screen">
      <AuroraField />

      {/* ===== 顶栏 ===== */}
      <header className="sticky top-0 z-40 border-b border-line-soft bg-void/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5">
          <RadarLogo size={36} />
          <div className="min-w-0 leading-tight">
            <h1 className="truncate font-mono text-[17px] font-black tracking-[0.12em]">
              <span className="grad-text">HOT//MONITOR</span>
            </h1>
            <p className="truncate font-mono text-[9px] tracking-[0.42em] text-faint">AI 热点情报雷达 · 快人一步吃瓜</p>
          </div>

          <div className="ml-auto flex items-center gap-2 font-mono text-[10px]">
            <span className="mr-1 hidden items-center gap-1.5 rounded-full border border-mint/25 bg-mint/[0.06] px-2.5 py-1 text-mint sm:inline-flex">
              <span className="live-dot" /> LIVE
            </span>
            <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 md:inline-flex ${data.health?.ai ? 'border-mint/25 bg-mint/[0.05] text-mint' : 'border-warn/30 bg-warn/[0.06] text-warn'}`}>
              <span className={`dot ${data.health?.ai ? 'good' : 'warn'}`} /> {data.health?.ai ? 'AI 联机' : 'AI 降级'}
            </span>
            <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 lg:inline-flex ${data.health?.twitter ? 'border-cyan/25 bg-cyan/[0.05] text-cyan' : 'border-line text-faint'}`}>
              <span className={`dot ${data.health?.twitter ? 'cy' : 'idle'}`} /> X {data.health?.twitter ? '接入' : '未接'}
            </span>
            <button className="btn small inline-flex items-center gap-1.5" onClick={requestDesktop} title="浏览器桌面提醒">
              <Icon.bell size={12} /> <span className="hidden sm:inline">{desktopOk ? '提醒开' : '提醒关'}</span>
            </button>
            <button className="btn small relative inline-flex items-center" onClick={() => setNotifOpen(true)} aria-label="打开通知中心">
              <Icon.bell size={13} />
              {unread > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-linear-to-br from-rose to-vio px-1 font-mono text-[9px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
            </button>
            <button className="btn small inline-flex items-center" onClick={() => setSettingsOpen(true)} aria-label="设置"><Icon.gear size={13} /></button>
          </div>
        </div>
      </header>

      {/* ===== 情报快讯 ===== */}
      <Ticker signals={data.signals} trends={data.trends} />

      {/* ===== 主区 ===== */}
      <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <WatchPanel keywords={data.keywords} signalsByKw={signalsByKw} busyId={scanId}
            onScan={scanKeyword} onAdd={refresh} onToggle={toggleKeyword} onRemove={removeKeyword}
            lastSeen={freshSigIds} />
        </div>
        <div className="lg:col-span-7">
          <TrendPanel scope={s?.scope} trends={data.trends} refreshing={refreshing}
            onRefresh={refreshTrends} newIds={freshTrendIds}
            lastRun={lastRun?.status === 'done' ? fmtTime(lastRun.finished_at) : ''} />
        </div>

        {/* ===== 遥测条 ===== */}
        <GlowCard className="glass rounded-2xl lg:col-span-12">
          <header className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-cyan/10 text-cyan"><Icon.db size={14} /></span>
            <span className="sect">运行遥测 <span className="text-faint normal-case tracking-normal">TELEMETRY</span></span>
            <span className="ml-auto hidden font-mono text-[10px] text-faint sm:inline">数据持久化于本地 SQLite</span>
          </header>
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 px-5 py-4 font-mono text-[11px] md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="mb-1 text-[9px] font-bold tracking-[0.2em] text-faint">调度</p>
              <p className="text-dim">每 {s?.pollMinutes || 30} 分钟 · 哨兵+雷达</p>
              <p className="mt-0.5 text-faint">窗口 {s?.lookbackHours || 24}h · 领域「{s?.scope?.name || 'AI 编程'}」</p>
            </div>
            <div>
              <p className="mb-1 text-[9px] font-bold tracking-[0.2em] text-faint">信源开关</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {[['websearch', '网页搜索', toggles.websearch], ['twitter', 'X 推文', toggles.twitter], ['mock', '演示源', toggles.mock]].map(([k, label, on]) => (
                  <span key={k} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${on ? 'border-vio/30 bg-vio/[0.07] text-vio' : 'border-line text-faint'}`}>
                    <span className={`dot ${on ? 'vio' : 'idle'}`} style={{ width: 6, height: 6 }} />{label}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[9px] font-bold tracking-[0.2em] text-faint">最近批次</p>
              {lastRun ? (
                <>
                  <p className="text-dim">{lastRun.status} · 上榜 {lastRun.items} · {fmtTime(lastRun.finished_at || lastRun.started_at)}</p>
                  <p className="mt-0.5 truncate text-faint" title={lastRun.note || ''}>{lastRun.note || lastRun.scope}</p>
                </>
              ) : <p className="text-faint">尚无批次</p>}
            </div>
            <div>
              <p className="mb-1 text-[9px] font-bold tracking-[0.2em] text-faint">信源健康</p>
              {data.sources.length === 0 ? <p className="text-faint">等待首次采集</p> : (
                <ul className="space-y-1">
                  {data.sources.map((m) => (
                    <li key={m.source} className="flex items-center gap-2">
                      <span className={`dot ${m.last_ok ? 'good' : 'bad'}`} style={{ width: 6, height: 6 }} />
                      <span className="truncate text-dim">{m.source}</span>
                      <span className="ml-auto text-faint">{m.last_count} 条</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <footer className="flex flex-wrap items-center gap-3 border-t border-line-soft px-5 py-2.5">
            <button className="btn small" onClick={runWatchAll}><span className="flex items-center gap-1.5"><Icon.zap size={12} /> 一键全员扫描</span></button>
            <span className="font-mono text-[9.5px] text-faint">真实数据请关掉「演示源」并配置 .env；演示源用于全链路验证</span>
          </footer>
        </GlowCard>
      </main>

      <footer className="pb-5 pt-1 text-center font-mono text-[9px] tracking-widest text-faint">
        HOT//MONITOR v2 · Aceternity UI 风格 · OpenRouter + twitterapi.io · AI 验真 / 多信源聚合
      </footer>

      <Toasts toasts={toasts} onClose={closeToast} />
      <NotifDrawer open={notifOpen} notifications={data.notifications} unread={unread}
        onClose={() => setNotifOpen(false)} onRead={markRead} onReadAll={readAll} />
      <SettingsModal open={settingsOpen} settings={data.settings} health={data.health}
        onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
    </div>
  );
}
