// UTF-8 judge quality test (convert to UTF-8 before running: enc.ps1 -Mode Node)
import { loadSettings } from '../server/config.js';
import { judge } from '../server/ai.js';
loadSettings();

const PAST = '2026-09-02T08:00:00.000Z';
const samples = [
  {
    keyword: 'GPT-5',
    item: { source: 'web', title: '闇囨儕锛丟PT-5 宸茶绉樺瘑璁粌瀹屾垚锛孫penAI 涓嬫湀灏嗙獊鐒跺彂甯冿紝鍐呴儴浜哄＋鐖嗘枡', summary: '鎹尶鍚嶅唴閮ㄤ汉澹О锛孫penAI 鐨?? GPT-5 宸茬粡绉樺瘑瀹屾垚璁粌锛屽皢浜庝笅鏈堢獊鐒跺彂甯冦??', url: 'https://fake-news.example.com/gpt5-leak', publishedAt: PAST },
  },
  {
    keyword: 'GPT-5',
    item: { source: 'web', title: 'GPT-5 鐮磋В鐗堟棤闄愭鍏嶈垂浣跨敤锛屾棤闇鐧诲綍锛岀偣鍑诲嵆鐢??', summary: 'GPT-5 鐮磋В涓嬭浇绔欙紝姘镐箙鍏嶈垂锛岀偣鍑婚鍙栥??', url: 'https://crack-download.example.net/gpt5-free', publishedAt: PAST },
  },
  {
    keyword: 'GPT-5',
    item: { source: 'web', title: 'OpenAI 鍙戝竷 GPT-5 瀹樻柟鎶鏈崥瀹細浠嬬粛鏂颁竴浠ｆ帹鐞嗚兘鍔涗笌澶氭ā鎬佹敮鎸??', summary: 'OpenAI 瀹樻柟鍗氬浠婃棩鏇存柊锛岃缁嗚鏄?? GPT-5 鍦ㄦ暟瀛︽帹鐞嗐佷唬鐮佺敓鎴愮瓑浠诲姟涓婄殑杩涘睍銆??', url: 'https://openai.com/blog/gpt-5', publishedAt: PAST },
  },
  {
    keyword: 'GPT-5',
    item: { source: 'twitter', title: '鏈変汉寮濮嬫嬁 GPT-5 鍜?? Claude 瀵规瘮鍐欎唬鐮佷簡 瀹炴祴缁撴灉鏈夌偣鎰忔??', summary: '瀹炴祴瀵规瘮 GPT-5 涓?? Claude 鍦ㄤ唬鐮佺敓鎴愪笂鐨勮〃鐜帮紝缁撹鏄悇鏈変紭鍔ｃ??', url: 'https://x.com/someuser/status/1', publishedAt: PAST },
  },
  {
    keyword: 'iPhone',
    item: { source: 'web', title: 'GPT-5 鏂扮増鏈湪涓枃璇涓嬬殑琛ㄧ幇鍏ㄩ潰璇勬祴', summary: '涓绡囧叧浜庡ぇ妯″瀷鐨勮瘎娴嬫枃绔狅紝涓?? iPhone 鎵嬫満鏃犲叧銆??', url: 'https://blog.example.com/gpt5-cn-review', publishedAt: PAST },
  },
];

for (const s of samples) {
  try {
    const r = await judge(s.item, s.keyword);
    console.log(`[${s.keyword}] verdict=${r.verdict} related=${r.related} authentic=${r.authentic} score=${r.score} model=${r.model}`);
    console.log(`    reason: ${r.reason}`);
  } catch (e) {
    console.log('ERR', e.message);
  }
}
