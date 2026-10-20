import { Icon } from './misc.jsx';

// ---- 可选值定义 ----
export const SORTS = [
  ['heat', '热度优先'],
  ['newest', '最新优先'],
  ['oldest', '最早优先'],
  ['score', 'AI 评分优先'],
  ['verdict', '判定可信度优先'],
];

export const TREND_SORTS = [
  ['heat', '热度优先'],
  ['level', '等级优先'],
  ['newest', '最新优先'],
  ['oldest', '最早优先'],
];

export const RANGES = [
  [1, '1 小时'],
  [6, '6 小时'],
  [24, '24 小时'],
  [72, '3 天'],
  [168, '7 天'],
  [0, '不限'],
];

export const VERDICTS = [
  ['authentic', '已确认'],
  ['unverified', '待核验'],
  ['fake', '疑似假'],
  ['unrelated', '无关'],
];

export const SOURCES = [
  ['bilibili', 'B站'],
  ['sogou', '搜狗'],
  ['so360news', '360 资讯'],
  ['so360', '360 搜索'],
  ['bing', '必应'],
  ['baidu', '百度'],
  ['twitter', 'X 推文'],
  ['weibo', '微博'],
];

// 相关度筛选：依赖后端写入的 coverage（关键词覆盖度）
export const REL_FILTERS = [
  ['all', '全部'],
  ['strong', '强相关'],
  ['partial', '部分命中'],
];

export const DEFAULT_PREFS = {
  sort: 'heat',
  rangeHours: 168,
  verdicts: [],
  sources: [],
  keyword: '',
  relFilter: 'all',
  density: 'cozy',
  groupByDate: false,
  reasonOpenAll: false,
};

const VERDICT_RANK = { authentic: 0, unverified: 1, fake: 2, unrelated: 3 };
const LEVEL_RANK = { S: 0, A: 1, B: 2, C: 3 };

export function mergePrefs(p) {
  const src = p && typeof p === 'object' ? p : {};
  return {
    sort: src.sort || 'heat',
    rangeHours: src.rangeHours === undefined ? 168 : Number(src.rangeHours) || 0,
    verdicts: Array.isArray(src.verdicts) ? src.verdicts : [],
    sources: Array.isArray(src.sources) ? src.sources : [],
    keyword: typeof src.keyword === 'string' ? src.keyword : '',
    relFilter: ['all', 'strong', 'partial'].includes(src.relFilter) ? src.relFilter : 'all',
    density: src.density === 'compact' ? 'compact' : 'cozy',
    groupByDate: src.groupByDate === true,
    reasonOpenAll: src.reasonOpenAll === true,
  };
}

function withinRange(ts, rangeHours) {
  if (!rangeHours) return true;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= rangeHours * 3600 * 1000;
}

// 统一筛选：时间范围 / 判定状态 / 信源 / 关键词
export function applyFilters(rows, prefs, opts = {}) {
  const p = mergePrefs(prefs);
  const timeField = opts.timeField || 'seen_at';
  const verdictOf = opts.verdictOf || ((r) => r.verdict);
  const sourceOf = opts.sourceOf || ((r) => r.source);
  return (rows || []).filter((r) => {
    if (!r) return false;
    if (!withinRange(r[timeField], p.rangeHours)) return false;
    if (p.verdicts.length && p.verdicts.includes(verdictOf(r)) === false) return false;
    if (p.sources.length && p.sources.includes(sourceOf(r)) === false) return false;
    if (p.keyword && r.keyword !== p.keyword) return false;
    if (p.relFilter !== 'all') {
      const cov = typeof r.coverage === 'number' ? r.coverage : null;
      if (cov === null) return false;
      if (p.relFilter === 'strong' && cov < 1) return false;
      if (p.relFilter === 'partial' && cov >= 1) return false;
    }
    return true;
  });
}

// 统一排序
export function sortRows(rows, prefs) {
  const p = mergePrefs(prefs);
  const list = [...(rows || [])];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : -1);
  const ts = (r) => {
    const t = Date.parse(r.seen_at || r.updated_at || r.first_seen || 0);
    return Number.isNaN(t) ? 0 : t;
  };
  const rank = (table, v, dflt) => (table[v] === undefined ? dflt : table[v]);
  const cmp = {
    heat: (a, b) => num(b.heat === undefined ? b.score : b.heat) - num(a.heat === undefined ? a.score : a.heat) || ts(b) - ts(a),
    score: (a, b) => num(b.score) - num(a.score) || ts(b) - ts(a),
    newest: (a, b) => ts(b) - ts(a),
    oldest: (a, b) => ts(a) - ts(b),
    verdict: (a, b) => rank(VERDICT_RANK, a.verdict, 9) - rank(VERDICT_RANK, b.verdict, 9) || ts(b) - ts(a),
    level: (a, b) => rank(LEVEL_RANK, a.level, 9) - rank(LEVEL_RANK, b.level, 9) || num(b.heat) - num(a.heat),
  };
  return list.sort(cmp[p.sort] || cmp.heat);
}

// 按日期分组（今天 / 昨天 / 本周 / 更早）
export function groupByDate(rows, timeField = 'published_at') {
  const order = ['今天', '昨天', '本周', '更早'];
  const buckets = new Map(order.map((k) => [k, []]));
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  const t0 = d0.getTime();
  for (const r of rows || []) {
    const t = Date.parse((r && (r[timeField] || r.seen_at || r.first_seen)) || 0);
    if (Number.isNaN(t)) { buckets.get('更早').push(r); continue; }
    if (t >= t0) buckets.get('今天').push(r);
    else if (t >= t0 - 864e5) buckets.get('昨天').push(r);
    else if (t >= t0 - 6 * 864e5) buckets.get('本周').push(r);
    else buckets.get('更早').push(r);
  }
  return order.filter((k) => buckets.get(k).length > 0).map((k) => [k, buckets.get(k)]);
}

function Chip({ on, onClick, children, tone }) {
  const cls = on
    ? tone === 'vio'
      ? 'border-vio/50 bg-vio/[0.12] text-vio'
      : 'border-cyan/50 bg-cyan/[0.12] text-cyan'
    : 'border-line/70 text-faint hover:border-line hover:text-dim';
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${cls}`}>
      {children}
    </button>
  );
}

// 排序 + 筛选 + 视图控制条；prefs 变化通过 onChange 回传（由上层持久化）
export default function FilterBar({ prefs, onChange, sorts = SORTS, keywords, showVerdict = true, showReason = false, compact }) {
  const p = mergePrefs(prefs);
  const set = (patch) => onChange({ ...p, ...patch });
  const toggleIn = (key, value) => {
    const cur = p[key] || [];
    set({ [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] });
  };
  const activeCount =
    (p.rangeHours !== 168 ? 1 : 0) + (p.verdicts.length ? 1 : 0) + (p.sources.length ? 1 : 0) + (p.keyword ? 1 : 0) +
    (p.relFilter !== 'all' ? 1 : 0);

  return (
    <div className={`border-b border-line-soft ${compact ? 'px-3 py-1.5' : 'px-4 py-2'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] tracking-wider text-faint">排序</span>
        {sorts.map(([v, label]) => (
          <Chip key={v} on={p.sort === v} onClick={() => set({ sort: v })} tone="cy">{label}</Chip>
        ))}
        <span className="ml-1 font-mono text-[10px] tracking-wider text-faint">发现时间</span>
        {RANGES.map(([v, label]) => (
          <Chip key={v} on={p.rangeHours === v} onClick={() => set({ rangeHours: v })}>{label}</Chip>
        ))}
        {activeCount > 0 && (
          <button type="button" onClick={() => onChange({ ...DEFAULT_PREFS })}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-rose/40 px-2 py-0.5 font-mono text-[10px] text-rose transition-colors hover:bg-rose/10">
            <Icon.x size={9} /> 重置 {activeCount}
          </button>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {showVerdict && (
          <>
            <span className="font-mono text-[10px] tracking-wider text-faint">判定</span>
            {VERDICTS.map(([v, label]) => (
              <Chip key={v} on={p.verdicts.includes(v)} onClick={() => toggleIn('verdicts', v)}>{label}</Chip>
            ))}
          </>
        )}
        {keywords && keywords.length > 0 && (
          <>
            <span className="ml-1 font-mono text-[10px] tracking-wider text-faint">关键词</span>
            <Chip on={p.keyword === ''} onClick={() => set({ keyword: '' })}>全部</Chip>
            {keywords.map((k) => (
              <Chip key={k} on={p.keyword === k} onClick={() => set({ keyword: p.keyword === k ? '' : k })}>{k}</Chip>
            ))}
          </>
        )}
        <span className="ml-1 font-mono text-[10px] tracking-wider text-faint">相关度</span>
        {REL_FILTERS.map(([v, label]) => (
          <Chip key={v} on={p.relFilter === v} onClick={() => set({ relFilter: v })}
            tone={v === 'strong' ? 'vio' : undefined}>{label}</Chip>
        ))}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] tracking-wider text-faint">信源</span>
        <Chip on={p.sources.length === 0} onClick={() => set({ sources: [] })}>全部</Chip>
        {SOURCES.map(([v, label]) => (
          <Chip key={v} on={p.sources.includes(v)} onClick={() => toggleIn('sources', v)}>{label}</Chip>
        ))}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] tracking-wider text-faint">视图</span>
        <Chip on={p.density === 'compact'} onClick={() => set({ density: p.density === 'compact' ? 'cozy' : 'compact' })}>
          {p.density === 'compact' ? '紧凑' : '舒适'}
        </Chip>
        <Chip on={p.groupByDate} onClick={() => set({ groupByDate: p.groupByDate === false })}>按日期分组</Chip>
        {showReason && (
          <Chip on={p.reasonOpenAll} onClick={() => set({ reasonOpenAll: p.reasonOpenAll === false })}>
            {p.reasonOpenAll ? '收起全部理由' : '展开全部理由'}
          </Chip>
        )}
      </div>
    </div>
  );
}
