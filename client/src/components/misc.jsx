// 通用情报台元件：SVG 图标 / 判定徽章 / 来源标签 / 等级徽章 / 图例
const I = ({ children, size = 15, className = '', title = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    role="img"
    aria-label={title || 'icon'}
  >
    {children}
  </svg>
);

export const Icon = {
  radar: (p) => (<I {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" opacity="0.5" /><path d="M12 12 L19 5" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /></I>),
  bell: (p) => (<I {...p}><path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" /><path d="M10 20h4" /></I>),
  gear: (p) => (<I {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" /></I>),
  plus: (p) => (<I {...p}><path d="M12 5v14M5 12h14" /></I>),
  x: (p) => (<I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>),
  trash: (p) => (<I {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></I>),
  pause: (p) => (<I {...p}><path d="M8 5v14M16 5v14" /></I>),
  play: (p) => (<I {...p}><path d="M7 5l12 7-12 7Z" fill="currentColor" /></I>),
  refresh: (p) => (<I {...p}><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 3v4h-4" /></I>),
  ext: (p) => (<I {...p}><path d="M14 5h5v5M19 5l-8 8" /><path d="M19 14v5H5V5h5" /></I>),
  scan: (p) => (<I {...p}><circle cx="11" cy="11" r="6" /><path d="M11 7v4l3 2M20 20l-4-4" /></I>),
  check: (p) => (<I {...p}><path d="M4 12.5l5 5L20 6.5" /></I>),
  db: (p) => (<I {...p}><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></I>),
  zap: (p) => (<I {...p}><path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" /></I>),
  flame: (p) => (<I {...p}><path d="M12 3c1 3-1 4.5-1 6a2.6 2.6 0 0 0 4.2 2c.5-1 .3-2-.2-3 .5.4 1 .9 1.4 1.6C17.6 11.6 18 13 18 14.5A6.5 6.5 0 0 1 5 14.5C5 10 8 7.5 12 3Z" /></I>),
  radio: (p) => (<I {...p}><circle cx="12" cy="12" r="2.2" /><path d="M7.8 16.2a5.5 5.5 0 0 1 0-8.4M16.2 7.8a5.5 5.5 0 0 1 0 8.4" /></I>),
};

// 判定：verdict -> 灯与徽章
const VM = {
  authentic: { t: 'good', label: '已确认', cls: 'text-mint' },
  demo: { t: 'good', label: 'DEMO', cls: 'text-mint' },
  unverified: { t: 'warn', label: '待核验', cls: 'text-warn' },
  fake: { t: 'bad', label: '疑似假', cls: 'text-rose' },
  unrelated: { t: 'idle', label: '无关', cls: 'text-faint' },
  unknown: { t: 'idle', label: '未知', cls: 'text-faint' },
};

export function verdictOf(sig) {
  if (sig.verdict) return VM[sig.verdict] || VM.unknown;
  if (sig.related === 1 && sig.authentic === 1) return VM.authentic;
  if (sig.related === 1 && sig.authentic === 0) return VM.fake;
  return VM.unverified;
}

export function SigLight({ verdict }) {
  const v = VM[verdict] || VM.unknown;
  return <span className={`dot ${v.t}`} />;
}

export function VerdictBadge({ sig, showLabel }) {
  const v = verdictOf(sig);
  const label = showLabel ? v.label : '';
  return <span className={`vchip ${v.t}`} title={sig.reason || ''}>{label || v.label}</span>;
}

// 来源名 -> 展示名/样式族
const SRC_NAME = {
  bing: { label: 'BING', cls: 'src-bing' },
  so360: { label: '360', cls: 'src-360' },
  baidu: { label: 'BAIDU', cls: 'src-baidu' },
  duckduckgo: { label: 'DDG', cls: 'src-duckduckgo' },
  twitter: { label: 'X', cls: 'src-twitter' },
  mock: { label: 'DEMO', cls: 'src-mock' },
};

export function SourceTag({ source }) {
  const s = String(source || 'unknown').toLowerCase();
  const m = SRC_NAME[s] || { label: s, cls: 'src-unknown' };
  return <span className={`src ${m.cls}`}>{m.label}</span>;
}

export function LevelBadge({ level }) {
  const lv = level || 'C';
  return <span className={`lv ${lv}`}>{lv}</span>;
}

// 图例
export function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-faint">
      {items.map(([t, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className={`dot ${t}`} /> {label}
        </span>
      ))}
    </div>
  );
}

// 面板标题：带渐变小方块
export function Sect({ icon: Ic = Icon.radio, children, right }) {
  return (
    <header className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-linear-to-br from-vio/30 to-cyan/20 text-vio">
        <Ic size={14} />
      </span>
      <span className="sect">{children}</span>
      <span className="ml-auto flex items-center gap-2">{right}</span>
    </header>
  );
}
