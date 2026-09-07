import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useEventStream, fmtTime } from './lib/api.js';
import { RadarMark, Icon, Bracket } from './components/misc.jsx';
import Ticker from './components/Ticker.jsx';
import WatchPanel from './components/WatchPanel.jsx';
import TrendPanel from './components/TrendPanel.jsx';
import { Toasts, NotifDrawer, SettingsModal } from './components/Overlays.jsx';

const EMPTY = {
  keywords: [],
  signals: [],
  trends: [],
  notifications: [],
  sources: [],
  trendRuns: [],
  settings: null,
  health: { ai: false, twitter: false },
};

export default function App() {
  const [data, setData] = useState(EMPTY);
  const [notifOpen, setNotifOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanId, setScanId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [desktopOk, setDesktopOk] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );
  const [toasts, setToasts] = useState([]);
  const refreshTimer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.state();
      setData(s);
    } catch (e) {
      console.error('state fetch failed', e.message);
    }
  }, []);

  // 定时兜底刷新（SSE 断开时）
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [refresh]);

  const addToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts.slice(-3), { ...toast, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 8000);
  }, []);

  const closeToast = useCallback((id) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  const desktopNotify = useCallback((title, body, url) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(`HOT//MONITOR · ${title}`, { body, tag: url });
      if (url) {
        n.onclick = () => {
          window.open(url, '_blank');
          n.close();
        };
      }
    } catch { /* ignore */ }
  }, []);

  const debouncedRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 350);
  }, [refresh]);

  // SSE 事件处理
  const onEvent = useCallback(
    (type, d) => {
      if (type === 'signal.new') {
        const sig = d.signal;
        if (sig) {
          addToast({ type: 'signal', title: `信号确认【${d.keyword}】`, body: sig.title, url: sig.url });
          desktopNotify(d.keyword, sig.title, sig.url);
        }
        debouncedRefresh();
      } else if (type === 'trend.new') {
        const item = d.item;
        if (item && (item.level === 'S' || item.level === 'A')) {
          addToast({ type: 'trend', title: `新热点 [${item.level}]`, body: item.title, url: item.url });
        }
        debouncedRefresh();
      } else if (type === 'notice') {
        // scan.done 汇总只进收件箱；trend 汇总才弹提示
        if (d.type === 'notice') {
          addToast({ type: 'info', title: d.title, body: d.body });
        }
        debouncedRefresh();
      } else if (type === 'scan.done') {
        debouncedRefresh();
      } else if (type === 'hello' || type === 'message') {
        // ignore
      }
    },
    [addToast, desktopNotify, debouncedRefresh]
  );

  useEffect(() => useEventStream(onEvent), [onEvent]);

  // ---- 操作 ----
  const scanKeyword = async (kw) => {
    setScanId(kw.id);
    try {
      const r = await api.scanKeyword(kw.id);
      if (r.confirmed > 0 || r.added > 0) {
        addToast({
          type: 'info',
          title: `扫描完成【${kw.name}】`,
          body: `候选 ${r.candidates} · 新信号 ${r.added} · 确认 ${r.confirmed}`,
        });
      }
      await refresh();
    } catch (e) {
      addToast({ type: 'info', title: `扫描失败【${kw.name}】`, body: e.message });
    } finally {
      setScanId(null);
    }
  };

  const runWatchAll = async () => {
    try {
      const r = await api.runWatch();
      const added = (r.results || []).reduce((a, x) => a + (x.added || 0), 0);
      addToast({ type: 'info', title: '哨兵全员扫描', body: `新增 ${added} 条信号` });
      await refresh();
    } catch (e) {
      addToast({ type: 'info', title: '扫描失败', body: e.message });
    }
  };

  const refreshTrends = async () => {
    setRefreshing(true);
    try {
      const r = await api.refreshTrends();
      addToast({ type: 'info', title: '热点雷达刷新', body: `采集 ${r.candidates} · 上榜 ${r.kept} · 新增 ${r.added}` });
      await refresh();
    } catch (e) {
      addToast({ type: 'info', title: '热点刷新失败', body: e.message });
    } finally {
      setRefreshing(false);
    }
  };

  const saveSettings = async (patch) => {
    try {
      await api.saveSettings(patch);
      addToast({ type: 'info', title: '设置已保存', body: '轮询周期等参数已生效' });
      setSettingsOpen(false);
      await refresh();
    } catch (e) {
      addToast({ type: 'info', title: '保存失败', body: e.message });
    }
  };

  const requestDesktop = async () => {
    if (typeof Notification === 'undefined') {
      addToast({ type: 'info', title: '浏览器不支持桌面通知', body: '请使用 Chrome/Edge 打开' });
      return;
    }
    if (desktopOk) {
      setDesktopOk(false);
      return;
    }
    try {
      const p = await Notification.requestPermission();
      setDesktopOk(p === 'granted');
      addToast({
        type: 'info',
        title: p === 'granted' ? '桌面提醒已开启' : '未获得桌面提醒权限',
        body: p === 'granted' ? '后台标签页也能收到「真热点」弹窗' : '可在浏览器地址栏旁重新授权',
      });
    } catch { /* ignore */ }
  };

  const toggleKeyword = async (kw) => {
    await api.patchKeyword(kw.id, { enabled: kw.enabled ? 0 : 1 });
    refresh();
  };
  const removeKeyword = async (kw) => {
    await api.delKeyword(kw.id);
    refresh();
  };
  const markRead = async (id) => {
    await api.markRead(id);
    refresh();
  };
  const readAll = async () => {
    await api.readAll();
    refresh();
  };

  // 分组信号
  const signalsByKw = useMemo(() => {
    const m = {};
    for (const s of data.signals) {
      const k = s.keyword || '?';
      (m[k] = m[k] || []).push(s);
    }
    return m;
  }, [data.signals]);

  const unread = useMemo(() => data.notifications.filter((n) => !n.read).length, [data.notifications]);
  const s = data.settings;
  const lastTrendRun = data.trendRuns?.[0];
  const sources = data.sources || [];
  const cfg = { pollMinutes: s?.pollMinutes, model: s?.model, lookbackHours: s?.lookbackHours };
  const toggles = s?.sourceToggles || {};
  const scopes = s?.scope?.name;

  return (
    <div className="mx-auto min-h-screen max-w-[1560px]">
      {/* ===== 顶栏 ===== */}
      <header className="sticky top-0 z-40 border-b border-line bg-deck/90 backdrop-blur">
        <div className="flex items-center gap-3 px-3 py-2 sm:px-4">
          <RadarMark size={34} />
          <div className="min-w-0 leading-none">
            <h1 className="caret truncate font-mono text-[16px] font-bold tracking-[0.14em] text-ink">
              HOT<span className="text-signal">//</span>MONITOR
            </h1>
            <p className="mt-0.5 truncate font-mono text-[10px] tracking-[0.3em] text-faint">
              AI 热点情报雷达
            </p>
          </div>

          {/* 状态芯片 */}
          <div className="ml-auto flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
            <span className={`hidden items-center gap-1.5 border px-2 py-1 sm:flex ${data.health?.ai ? 'border-signal/40 text-signal' : 'border-warn/40 text-warn'}`}>
              <span className={`light ${data.health?.ai ? 'good' : 'warn'}`} />
              {data.health?.ai ? 'AI 联机' : 'AI 降级'}
            </span>
            <span className={`hidden items-center gap-1.5 border px-2 py-1 md:flex ${data.health?.twitter ? 'border-signal/40 text-signal' : 'border-line text-faint'}`}>
              <span className={`light ${data.health?.twitter ? 'good' : 'idle'}`} />
              X {data.health?.twitter ? '接入' : '未接'}
            </span>
            <button className={`btn small flex items-center gap-1.5 ${desktopOk ? '' : ''}`} onClick={requestDesktop} title="浏览器桌面提醒">
              <Icon.bell size={12} />
              <span className="hidden sm:inline">{desktopOk ? '提醒开' : '提醒关'}</span>
            </button>
            <button
              className="btn small relative flex items-center gap-1"
              onClick={() => setNotifOpen(true)}
              aria-label="打开通知中心"
            >
              <Icon.bell size={12} />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center bg-alert px-1 font-mono text-[9px] font-bold text-black">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
            <button className="btn small flex items-center gap-1" onClick={() => setSettingsOpen(true)}>
              <Icon.gear size={12} />
            </button>
          </div>
        </div>
      </header>

      {/* ===== 情报跑马灯 ===== */}
      <Ticker signals={data.signals} trends={data.trends} />

      {/* ===== 主区 ===== */}
      <main className="grid grid-cols-1 gap-3 px-3 py-3 lg:grid-cols-12 lg:px-4">
        <div className="lg:col-span-5">
          <WatchPanel
            keywords={data.keywords}
            signalsByKw={signalsByKw}
            busyId={scanId}
            onScan={scanKeyword}
            onAdd={refresh}
            onToggle={toggleKeyword}
            onRemove={removeKeyword}
          />
        </div>
        <div className="lg:col-span-7">
          <TrendPanel
            scope={s?.scope}
            trends={data.trends}
            refreshing={refreshing}
            onRefresh={refreshTrends}
            lastRun={lastTrendRun?.status === 'done' ? fmtTime(lastTrendRun.finished_at) : ''}
          />
        </div>

        {/* ===== 运行状态条 ===== */}
        <div className="panel lg:col-span-12">
          <header className="panel-head">
            <Icon.db size={15} className="text-signal" />
            <Bracket text="运行状态 SYS-STATUS" />
            <span className="ml-auto font-mono text-[10px] text-faint">数据持久化于本地 SQLite</span>
          </header>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-3 font-mono text-[11px] md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="mb-1 font-bold tracking-wider text-dim">调度</p>
              <p className="text-ink">
                每 {cfg.pollMinutes || 30} 分钟自动执行 哨兵 + 雷达
                <span className="ml-2 text-faint">窗口 {cfg.lookbackHours || 24}h</span>
              </p>
              <p className="mt-0.5 text-faint">
                领域: {scopes || 'AI 编程'} · 模型: {cfg.model || '-'}
              </p>
            </div>
            <div>
              <p className="mb-1 font-bold tracking-wider text-dim">信源开关</p>
              <p className="text-ink">
                网页搜索 {toggles.websearch ? '[ON]' : '[OFF]'} · X 推文 {toggles.twitter ? '[ON]' : '[OFF]'} ·
                演示源 {toggles.mock ? '[ON]' : '[OFF]'}
              </p>
              <p className="mt-0.5 text-faint">控频爬虫：Bing + DuckDuckGo 双引擎</p>
            </div>
            <div>
              <p className="mb-1 font-bold tracking-wider text-dim">最近雷达批次</p>
              {lastTrendRun ? (
                <>
                  <p className="text-ink">
                    {lastTrendRun.status} · 上榜 {lastTrendRun.items} 条 · {fmtTime(lastTrendRun.finished_at || lastTrendRun.started_at)}
                  </p>
                  <p className="mt-0.5 truncate text-faint" title={lastTrendRun.note || ''}>
                    {lastTrendRun.note || lastTrendRun.scope}
                  </p>
                </>
              ) : (
                <p className="text-faint">尚无批次记录</p>
              )}
            </div>
            <div>
              <p className="mb-1 font-bold tracking-wider text-dim">信源健康</p>
              {sources.length === 0 ? (
                <p className="text-faint">暂无采集记录（等待首次任务）</p>
              ) : (
                <ul className="space-y-0.5">
                  {sources.map((m) => (
                    <li key={m.source} className="flex items-center gap-2">
                      <span className={`light ${m.last_ok ? 'good' : 'bad'}`} style={{ width: 7, height: 7 }} />
                      <span className="truncate text-ink">{m.source}</span>
                      <span className="ml-auto text-faint">{m.last_count} 条</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2">
            <button className="btn small" onClick={runWatchAll}>
              <span className="flex items-center gap-1"><Icon.scan size={12} /> 哨兵全员扫描</span>
            </button>
            <span className="font-mono text-[10px] text-faint">
              提示：真实数据请关掉「演示源」并在 .env 配置 Key 后重启；演示源用于全链路验证。
            </span>
          </footer>
        </div>
      </main>

      <footer className="px-4 pb-4 text-center font-mono text-[10px] text-faint">
        HOT//MONITOR v1.0 · OpenRouter + twitterapi.io · 情报自动发现 / AI 验真 / 多信源聚合
      </footer>

      {/* ===== 浮层 ===== */}
      <Toasts toasts={toasts} onClose={closeToast} />
      <NotifDrawer
        open={notifOpen}
        notifications={data.notifications}
        unread={unread}
        onClose={() => setNotifOpen(false)}
        onRead={markRead}
        onReadAll={readAll}
      />
      <SettingsModal
        open={settingsOpen}
        settings={data.settings}
        health={data.health}
        meta={{ config: data.meta ? data.meta.config : {} }}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
      />
    </div>
  );
}
