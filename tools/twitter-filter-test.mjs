// ASCII: offline test of twitter reply/engagement filtering by mocking global fetch
import { searchTweets } from '../server/sources/twitter.js';

const tweets = [
  { // normal viral tweet -> should pass (like+rt+reply >= 100)
    id_str: '1', text: 'Big announcement about Claude coding agent', created_at: new Date(Date.now() - 3600e3).toISOString(),
    user: { username: 'dev', profile_image_url_https: '' },
    like_count: 80, retweet_count: 30, reply_count: 5,
  },
  { // low engagement -> should be dropped
    id_str: '2', text: 'Random tiny thought on Claude', created_at: new Date(Date.now() - 3600e3).toISOString(),
    user: { username: 'nobody' }, like_count: 2, retweet_count: 0, reply_count: 1,
  },
  { // reply tweet (field-level) -> dropped regardless of engagement
    id_str: '3', text: '@someone yes agreed on Claude', in_reply_to_status_id: '999', created_at: new Date(Date.now() - 3600e3).toISOString(),
    user: { username: 'replier' }, like_count: 500, retweet_count: 900, reply_count: 40,
  },
  { // old tweet outside lookback -> dropped by lookback
    id_str: '4', text: 'Old viral Claude thing', created_at: new Date(Date.now() - 48 * 3600e3).toISOString(),
    user: { username: 'old' }, like_count: 900, retweet_count: 900, reply_count: 900,
  },
];
globalThis.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({ tweets }),
});

try {
  const out = await searchTweets('"Claude"', 24);
  console.log('kept count:', out.length, '(expect 1)');
  for (const it of out) console.log(' kept:', it.extra.tweetId, 'eng', it.extra.likeCount + it.extra.retweetCount + it.extra.replyCount);
} catch (e) {
  console.log('ERR', e.message);
}
