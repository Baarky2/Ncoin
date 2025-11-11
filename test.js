import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  vus: 100, // 同時100ユーザー
  iterations: 10000, // 合計10000回リクエスト
  thresholds: {
    http_req_failed: ['rate<0.05'],   // 失敗率5%未満
    http_req_duration: ['p(95)<1000'] // 95%が1秒以内
  },
};

export default function () {
  const baseURL = 'https://ncoin-w4hm.onrender.com'; // ← RenderのベースURL

  // ランダムユーザー名（user0〜user99）
  const userA = `user${Math.floor(Math.random() * 100)}`;
  const userB = `user${Math.floor(Math.random() * 100)}`;

  // ランダム送金額（1〜50）
  const amount = Math.floor(Math.random() * 50) + 1;

  // POST送信
  const res = http.post(`${baseURL}/send`, JSON.stringify({
    from: userA,
    to: userB,
    amount,
  }), { headers: { 'Content-Type': 'application/json' }});

  // レスポンスチェック
  check(res, {
    'status is 200 or 400': (r) => [200, 400].includes(r.status),
  });

  sleep(0.1); // 少し間を空ける
}
