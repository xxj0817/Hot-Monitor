import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// ---------- cn 工具（Aceternity/shadcn 通用） ----------
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// ---------- Aurora 极光层（Aceternity aurora-background 精简实现，CSS 驱动、低开销） ----------
// 用法：作为固定背景放页面最底层（见 App），透明度已克制，不干扰阅读。
export function AuroraField({ className }) {
  return (
    <>
      <div aria-hidden className="aurora" style={{ animation: 'var(--animate-aurora)' }} />
      <div aria-hidden className="grid-bg" />
      {/* 顶部聚光（Aceternity Spotlight 风格静态装饰） */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[420px] overflow-hidden">
        <div
          className="absolute left-1/2 top-[-160px] h-[380px] w-[820px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, rgba(139,92,246,0.55), rgba(34,211,238,0.22) 55%, transparent 75%)' }}
        />
      </div>
    </>
  );
}

// ---------- Spotlight 鼠标聚光卡片（Aceternity spotlight-card 效果） ----------
// 鼠标移动时卡片内出现跟随的径向高光，低调科技感；纯 CSS 变量 + React，无额外动画库开销。
export function GlowCard({ children, className, color = 'rgba(139, 92, 246, 0.18)', radius = 320 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const onMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      className={cn('relative overflow-hidden', className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: active ? 1 : 0,
          background: `radial-gradient(${radius}px circle at ${pos.x}px ${pos.y}px, ${color}, transparent 65%)`,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

// ---------- 渐变进度条（热力/信号强度） ----------
export function HeatGrad({ value, tone = 'b' }) {
  return (
    <div className="heat" role="img" aria-label={`热度 ${value}`}>
      <i className={tone} style={{ width: `${Math.max(3, Math.min(100, value))}%` }} />
    </div>
  );
}

// ---------- 圆环雷达 LOGO（旋转渐变环 + 扫描点） ----------
export function RadarLogo({ size = 34, spin = true }) {
  const [deg, setDeg] = useState(0);
  useEffect(() => {
    if (!spin) return;
    let raf;
    const t0 = performance.now();
    const step = (t) => {
      setDeg(((t - t0) / 3200) * 360);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin]);
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }} aria-hidden>
      {/* 渐变外环 */}
      <svg width={size} height={size} viewBox="0 0 48 48" className="absolute inset-0">
        <defs>
          <linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="22" fill="none" stroke="#ffffff12" strokeWidth="2" />
        <circle cx="24" cy="24" r="22" fill="none" stroke="url(#ringg)" strokeWidth="2"
          strokeDasharray="96 42" strokeLinecap="round"
          transform={spin ? `rotate(${deg} 24 24)` : undefined} />
      </svg>
      <div className="relative h-[62%] w-[62%] rounded-full border border-white/10 bg-void/60" style={{ boxShadow: 'inset 0 0 18px rgba(139,92,246,0.25)' }}>
        <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-vio shadow-[0_0_10px_2px_rgba(139,92,246,0.8)]" />
      </div>
    </div>
  );
}

// ---------- 提示用小组件 ----------
export function Chip({ children, className, dot }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-wide', className)}>
      {dot && <span className="dot good" />}
      {children}
    </span>
  );
}
