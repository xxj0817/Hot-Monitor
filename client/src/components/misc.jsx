// 通用情报台元件：SVG 图标 / 雷达 LOGO / 信号灯 / 徽章 / 热力条 / 标签
const I = ({ children, size = 15, className = '', title = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="square"
    className={className}
    role="img"
    aria-label={title || 'icon'}
  >
    {children}
  </svg>
);

export const Icon = {
  radar: (p) => (
    <I {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" opacity="0.5" />
      <path d="M12 12 L19 5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </I>
  ),
  bell: (p) => (
    <I {...p}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" />
      <path d="M10 20h4" />
    </I>
  ),
  gear: (p) => (
    <I {...p}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" />
    </I>
  ),
  plus: (p) => (
    <I {...p}>
      <path d="M12 5v14M5 12h14" />
    </I>
  ),
  x: (p) => (
    <I {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </I>
  ),
  trash: (p) => (
    <I {...p}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </I>
  ),
  pause: (p) => (
    <I {...p}>
      <path d="M8 5v14M16 5v14" />
    </I>
  ),
  play: (p) => (
    <I {...p}>
      <path d="M7 5l12 7-12 7Z" fill="currentColor" />
    </I>
  ),
  refresh: (p) => (
    <I {...p}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 3v4h-4" />
    </I>
  ),
  ext: (p) => (
    <I {...p}>
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M19 14v5H5V5h5" />
    </I>
  ),
  scan: (p) => (
    <I {...p}>
      <circle cx="11" cy="11" r="6" />
      <path d="M11 7v4l3 2M20 20l-4-4" />
    </I>
  ),
  check: (p) => (
    <I {...p}>
      <path d="M4 12.5l5 5L20 6.5" />
    </I>
  ),
  db: (p) => (
    <I {...p}>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </I>
  ),
};

// 雷达 LOGO：固定圆环 + 旋转扫柄
export function RadarMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="none" stroke="#223052" strokeWidth="2" />
      <circle cx="24" cy="24" r="15" fill="none" stroke="#223052" strokeWidth="1" />
      <circle cx="24" cy="24" r="8" fill="none" stroke="#223052" strokeWidth="1" />
      <circle cx="24" cy="24" r="2.4" fill="#2EE6A8" />
      <g className="radar-sweep" style={{ transformOrigin: '24px 24px' }}>
        <path d="M24 24 L24 4 A20 20 0 0 1 41.9 15.5 Z" fill="url(#radarg)" opacity="0.5" />
      </g>
      <defs>
        <linearGradient id="radarg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2EE6A8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#2EE6A8" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// 判定信号灯
const VERDICT_MAP = {
  authentic: { light: 'good', label: '可信', tone: 'text-signal' },
  demo: { light: 'good', label: 'DEMO', tone: 'text-signal' },
  unverified: { light: 'warn', label: '存疑', tone: 'text-warn' },
  fake: { light: 'bad', label: '疑似假', tone: 'text-alert' },
  unrelated: { light: 'idle', label: '无关', tone: 'text-dim' },
  unknown: { light: 'idle', label: '未知', tone: 'text-dim' },
};

export function verdictOf(sig) {
  if (sig.verdict) return VERDICT_MAP[sig.verdict] || VERDICT_MAP.unknown;
  // 兼容旧数据
  if (sig.related === 1 && sig.authentic === 1) return VERDICT_MAP.authentic;
  if (sig.related === 1 && sig.authentic === 0) return VERDICT_MAP.fake;
  return VERDICT_MAP.unverified;
}

export function SigLight({ verdict }) {
  const v = VERDICT_MAP[verdict] || VERDICT_MAP.unknown;
  return <span className={`light ${v.light} ${verdict === 'demo' ? 'blink' : ''}`} />;
}

export function VerdictBadge({ sig }) {
  const v = verdictOf(sig);
  return (
    <span className={`font-mono text-[10px] tracking-widest ${v.tone}`} title={sig.reason || ''}>
      {v.label}
    </span>
  );
}

export function SourceTag({ source }) {
  return <span className={`tag src-${source || 'unknown'}`}>{source || 'unknown'}</span>;
}

export function LevelBadge({ level }) {
  return <span className={`lv ${level || 'C'}`}>{level || 'C'}</span>;
}

export function HeatBar({ heat, level }) {
  const cls = level === 'S' || heat >= 75 ? 'hot' : level === 'A' || heat >= 55 ? 'warn' : '';
  return (
    <span className="heatbar block w-full" style={{ minWidth: 40 }}>
      <i className={cls} style={{ width: `${Math.max(4, Math.min(100, heat))}%` }} />
    </span>
  );
}

export function Bracket({ text, tone = 'on' }) {
  return (
    <span className="brack">
      [<b className={tone}>{text}</b>]
    </span>
  );
}
