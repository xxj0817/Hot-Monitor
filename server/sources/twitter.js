// Twitter/X 信源：twitterapi.io Advanced Search（需 TWITTER_API_KEY）
// 文档：https://docs.twitterapi.io/api-reference/endpoint/tweet_advanced_search
// GET /twitter/tweet/advanced_search?queryType=Latest&query=<expr>  头: x-api-key
// query 时间过滤用 since_time/until_time（Unix 秒），不支持 since:YYYY-MM-DD
import { env, getSettings } from '../config.js';
import { norm, withinLookback } from './base.js';
import { touchSource } from '../db.js';

const BASE = 'https://api.twitterapi.io';
const LOOKBACK_S = 24 * 3600;

export function isConfigured() {
  return !!env.twitterKey;
}

function pick(o, keys, dflt) {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  }
  return dflt;
}

function mapTweet(t) {
  const id = pick(t, ['id_str', 'id', 'rest_id'], '');
  const text = pick(t, ['text', 'full_text'], '');
  const isReply = detectReply(t, text);
  const user = t.user || {};
  const username = pick(user, ['username', 'screen_name'], '');
  const createdAt = pick(t, ['created_at'], new Date().toISOString());
  const counts = t;
  const base = {
    title: text.slice(0, 80) + (text.length > 80 ? '...' : ''),
    summary: text,
    author: username ? `@${username}` : '',
    source: 'twitter',
    publishedAt: parseDate(createdAt),
    extra: {
      tweetId: String(id),
      likeCount: Number(pick(counts, ['like_count'], 0) || 0),
      retweetCount: Number(pick(counts, ['retweet_count'], 0) || 0),
      replyCount: Number(pick(counts, ['reply_count'], 0) || 0),
      viewCount: Number(pick(counts, ['view_count'], 0) || 0),
      avatar: pick(user, ['profile_image_url_https', 'profile_image_url'], ''),
      isReply,
    },
  };
  return norm({ ...base, url: `https://x.com/${username}/status/${id}` });
}

// 字段级“是否为回复帖”检测：任何回复标记存在即视为回复
function detectReply(t, text) {
  if (!t) return false;
  for (const k of ['in_reply_to_status_id', 'in_reply_to_status_id_str', 'in_reply_to_tweet_id', 'reply_to']) {
    if (t[k] !== undefined && t[k] !== null && t[k] !== '') return true;
  }
  if (t.in_reply_to_user_id !== undefined && t.in_reply_to_user_id !== null) return true;
  return false;
}

function parseDate(s) {
  const ts = Date.parse(String(s));
  return Number.isNaN(ts) ? new Date().toISOString() : new Date(ts).toISOString();
}

// queryExpr 为 Twitter 搜索表达式，如: ("claude" OR "Claude") -is:retweet
export async function searchTweets(queryExpr, lookbackHours = 24) {
  if (!isConfigured()) {
    const err = new Error('TWITTER_API_KEY 未配置');
    touchSource('twitter', { ok: false, count: 0, error: err.message });
    throw err;
  }
  const sinceTime = Math.floor(Date.now() / 1000) - LOOKBACK_S;
  const expr = `${queryExpr} -is:retweet -is:reply since_time:${sinceTime}`;
  const url = `${BASE}/twitter/tweet/advanced_search?queryType=Latest&query=${encodeURIComponent(expr)}`;
  const res = await fetch(url, {
    headers: { 'x-api-key': env.twitterKey },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`twitter http ${res.status} ${body.slice(0, 200)}`);
  }
  const j = await res.json();
  if (!j || !Array.isArray(j.tweets)) {
    const msg = j && (j.message || j.error || JSON.stringify(j));
    throw new Error(`twitter resp: ${String(msg).slice(0, 200)}`);
  }
  // 质量过滤：字段级排除回复帖 -> 热度门槛（赞+转+评，可配置 twitterMinEngagement）
  const minEngagement = Number(getSettings().twitterMinEngagement) || 0;
  let rawItems = j.tweets.map(mapTweet).filter(Boolean);
  rawItems = rawItems.filter((it) => !(it.extra && it.extra.isReply));
  if (minEngagement > 0) {
    rawItems = rawItems.filter((it) => {
      const e = it.extra || {};
      return (Number(e.likeCount) || 0) + (Number(e.retweetCount) || 0) + (Number(e.replyCount) || 0) >= minEngagement;
    });
  }
  touchSource('twitter', { ok: true, count: rawItems.length });
  return rawItems.filter((it) => withinLookback(it, lookbackHours));
}
