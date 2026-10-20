import { Icon } from './misc.jsx';

// ---- 数据解析 ----
export function parseExtra(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch { return {}; }
}

const pad = (n) => String(n).padStart(2, '0');

export function fmtAbs(ts) {
  if (!ts) return '';
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch { return ''; }
}

// 发布时间新鲜度分档（用于徽章配色）
export function freshness(publishedAt) {
  if (!publishedAt) return null;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return null;
  const h = (Date.now() - t) / 3600000;
  if (h <= 6) return { key: 'new', label: '6 小时内' };
  if (h <= 24) return { key: 'day', label: '24 小时内' };
  if (h <= 72) return { key: 'd3', label: '3 天内' };
  if (h <= 168) return { key: 'd7', label: '7 天内' };
  return { key: 'old', label: '7 天前' };
}

const FRESH_CLS = {
  new: 'border-mint/40 bg-mint/[0.10] text-mint',
  day: 'border-cy/40 bg-cy/[0.10] text-cy',
  d3: 'border-vio/40 bg-vio/[0.10] text-vio',
  d7: 'border-line text-dim',
  old: 'border-line/60 text-faint',
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function compactNum(v) {
  const x = num(v);
  if (x >= 1e8) return (x / 1e8).toFixed(1) + ' 亿';
  if (x >= 1e4) return (x / 1e4).toFixed(1) + ' 万';
  return String(x);
}

// 相对时间（避免与 api.js 的 relTime 循环依赖，这里做最小实现）
export function agoOf(ts) {
  if (!ts) return '';
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' 天前';
  return fmtAbs(ts).slice(0, 10);
}

// 互动数据（按信源展示可用字段）
export function interactions(item) {
  const e = parseExtra(item.extra);
  const out = [];
  if (item.source === 'bilibili') {
    if (num(e.play) > 0) out.push(['播放', compactNum(e.play)]);
    if (num(e.like) > 0) out.push(['点赞', compactNum(e.like)]);
    if (num(e.reply) > 0) out.push(['评论', compactNum(e.reply)]);
    if (num(e.danmaku) > 0) out.push(['弹幕', compactNum(e.danmaku)]);
  } else if (item.source === 'twitter') {
    if (num(e.likeCount) > 0) out.push(['赞', compactNum(e.likeCount)]);
    if (num(e.retweetCount) > 0) out.push(['转推', compactNum(e.retweetCount)]);
    if (num(e.replyCount) > 0) out.push(['回复', compactNum(e.replyCount)]);
    if (num(e.viewCount) > 0) out.push(['浏览', compactNum(e.viewCount)]);
  } else {
    if (num(e.likeCount) > 0) out.push(['赞', compactNum(e.likeCount)]);
    if (num(e.viewCount) > 0) out.push(['浏览', compactNum(e.viewCount)]);
  }
  if (e.duration) out.push(['时长', String(e.duration)]);
  if (e.typename) out.push(['分区', String(e.typename)]);
  return out;
}

// 单条条目的元信息：发布时间 / 抓取时间 / 来源域名 / 多源印证 / 作者与粉丝 / 互动
export default function ItemMeta({ item, density = 'cozy', timeField = 'seen_at', showAuthor = true }) {
  if (!item) return null;
  const e = parseExtra(item.extra);
  const fresh = freshness(item.published_at);
  const grabbed = item[timeField] || item.seen_at;
  const host = hostOf(item.url);
  const inter = interactions(item);
  const corr = num(e.engineCount);
  const acc = e.account && typeof e.account === 'object' ? e.account : null;
  const compact = density === 'compact';

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-faint ${compact ? 'mt-0.5' : 'mt-1'}`}>
      <span className="inline-flex items-center gap-1" title={fmtAbs(item.published_at) || '未获取到发布时间'}>
        <Icon.clock size={10} />
        {item.published_at ? (
          <>
            发布 {agoOf(item.published_at)}
            {fresh && (
              <span className={`rounded-full border px-1.5 py-px text-[9px] ${FRESH_CLS[fresh.key]}`}>{fresh.label}</span>
            )}
          </>
        ) : (
          <span className="text-faint/70">发布时间未知</span>
        )}
      </span>

      {grabbed && (
        <span className="inline-flex items-center gap-1" title={`抓取时间 ${fmtAbs(grabbed)}`}>
          <Icon.zap size={10} /> 抓取 {agoOf(grabbed)}
        </span>
      )}

      {host && <span className="truncate text-faint/80" title={item.url}>{host}</span>}

      {corr >= 2 && (
        <span className="inline-flex items-center gap-1 text-cy" title={Array.isArray(e.corroborators) ? e.corroborators.join(' / ') : ''}>
          <Icon.check size={10} /> {corr} 源印证
        </span>
      )}

      {showAuthor && (item.author || acc) && (
        <span className="truncate" title={acc && acc.sign ? acc.sign : ''}>
          {item.author || (acc && acc.uname ? '@' + acc.uname : '')}
          {acc && num(acc.fans) > 0 ? ` · 粉丝 ${compactNum(acc.fans)}` : ''}
        </span>
      )}

      {inter.map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className="text-faint/70">{k}</span>
          <span className="text-dim">{v}</span>
        </span>
      ))}
    </div>
  );
}

// AI 判定理由：默认收起为一行，点击展开全文
export function ReasonText({ text, open, onToggle }) {
  if (!text) return null;
  return (
    <div className="mt-0.5">
      <button type="button" onClick={onToggle}
        className={`block w-full text-left text-[11px] leading-snug text-faint transition-colors hover:text-dim ${open ? '' : 'line-clamp-1'}`}
        title={open ? '点击收起' : '点击展开判定理由'}>
        {text}
      </button>
    </div>
  );
}

// 关键词高亮：把命中的关键词/扩展变体在文本中标记出来
export function highlightTerms(text, terms) {
  const src = String(text || '');
  const list = (terms || [])
    .map((t) => String(t || '').trim())
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (!src || !list.length) return src;
  const esc = list.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${esc.join('|')})`, 'gi');
  return src.split(re).map((part, i) => {
    if (!part) return null;
    const hit = list.some((t) => t.toLowerCase() === part.toLowerCase());
    if (!hit) return <span key={i}>{part}</span>;
    return (
      <mark key={i} className="rounded bg-cy/[0.16] px-0.5 text-cy">
        {part}
      </mark>
    );
  });
}

// 相关性证据块：依据（原文引用，命中词高亮）+ 相关性理由 + 真伪判定理由 + 覆盖度
export function RelevanceBlock({ item, terms, open, onToggle, compact }) {
  const ev = String(item.evidence || '').trim();
  const why = String(item.why || '').trim();
  const reason = String(item.reason || '').trim();
  const cov = typeof item.coverage === 'number' ? item.coverage : null;
  if (!ev && !why && !reason) return null;
  const covCls = cov === null ? 'text-faint' : cov >= 1 ? 'text-cy' : cov > 0 ? 'text-yl' : 'text-mg';
  const tag = 'mr-1.5 font-mono text-[9px] uppercase tracking-wider text-faint';
  return (
    <div className={`${compact ? 'mt-0.5' : 'mt-1'} space-y-0.5`}>
      {ev && (
        <div className="text-[11px] leading-snug text-dim">
          <span className={tag}>依据</span>
          <span className="italic">「{highlightTerms(ev, terms)}」</span>
          {cov !== null && <span className={`ml-1.5 font-mono text-[9px] ${covCls}`}>覆盖 {Math.round(cov * 100)}%</span>}
        </div>
      )}
      {why && (
        <div className="text-[11px] leading-snug text-dim">
          <span className={tag}>相关性</span>
          {why}
        </div>
      )}
      {reason && (
        <div className="text-[11px] leading-snug text-faint">
          <span className={`${tag} align-middle`}>判定</span>
          <button type="button" onClick={onToggle}
            className={`inline-align-middle text-left text-[11px] leading-snug text-faint transition-colors hover:text-dim ${open ? '' : 'line-clamp-1'}`}
            title={open ? '点击收起' : '点击展开判定理由'}>
            {reason}
          </button>
        </div>
      )}
    </div>
  );
}
