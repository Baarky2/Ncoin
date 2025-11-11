import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  vus: 100,              // 同時接続ユーザー数
  iterations: 10000,     // 総リクエスト数
  thresholds: {
    http_req_failed: ['rate<0.05'],   // 失敗率5%未満
    http_req_duration: ['p(95)<1000'] // 95%が1秒以内
  },
};

export default function () {
  const baseURL = 'https://ncoin-w4hm.onrender.com';
  
  // ランダムなユーザー名を生成
  const nickname = `user${Math.floor(Math.random() * 100)}`;
  
  // 最初にユーザーを作成（存在しなければ）
  http.post(`${baseURL}/login`, JSON.stringify({ nickname }), {
    headers: { 'Content-Type': 'application/json' },
  });

  // クイズに回答（全員正解にする）
  const res = http.post(`${baseURL}/send`, JSON.stringify({
    nickname,
    answer: "フルーツ",  // サーバー側の正解
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'status is 200 or 400': (r) => [200, 400].includes(r.status),
  });

  sleep(0.1);
}
