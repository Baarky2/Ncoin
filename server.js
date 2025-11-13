/**
 * 🚀 Improved Ncoin Server
 * 高速キャッシュ + 安全書き込み + 管理者権限対応版
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE;
const ADMIN_CODE = process.env.ADMIN_CODE || "Z4kL8PqR9"; // 管理者コード

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ======== 🧠 データ管理 ========
const DB_FILE = "users.json";
let dbCache = {};
let dirty = false;
let saveTimer = null;

// DB読み込み
function loadDB() {
  if (Object.keys(dbCache).length) return dbCache;
  try {
    dbCache = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    dbCache = {};
  }
  return dbCache;
}

// クイズ権限チェック
app.get("/quiz-rights/:nickname", (req, res) => {
  const db = loadDB();
  const user = db[req.params.nickname];
  if (!user) return res.status(404).json({ error: "ユーザーが存在しません" });

  res.json({ quizRights: user.quizRights || {} });
});
// 安全保存（5秒ごと）
function safeSaveDB(db) {
  dbCache = db;
  dirty = true;
  if (!saveTimer) {
    saveTimer = setInterval(() => {
      if (dirty) {
        fs.writeFile(DB_FILE, JSON.stringify(dbCache, null, 2), (err) => {
          if (err) console.error("❌ DB保存失敗:", err);
          else console.log("💾 DB保存完了");
        });
        dirty = false;
      }
    }, 5000);
  }
}

// 終了時に強制保存
process.on("SIGTERM", () => {
  if (dirty) fs.writeFileSync(DB_FILE, JSON.stringify(dbCache, null, 2));
  console.log("✅ 最終データ保存完了");
  process.exit(0);
});

// 初期化（必要なら自動生成）
/*function initUsers() {
  const db = loadDB();
  for (let i = 0; i < 50; i++) {
    const name = `user${i}`;
    if (!db[name]) db[name] = { balance: 100, history: [], isAdmin: false };
  }
  safeSaveDB(db);
  console.log("✅ 初期ユーザー登録完了");
}
initUsers();*/

// ======== 🧾 共通関数 ========
function validateNickname(name) {
  // 全角文字（日本語）・英数字・アンダースコア・ハイフンを許可
  return typeof name === "string" && /^[\p{L}\p{N}_-]{1,20}$/u.test(name);
}


// ======== 🌐 ページルート ========
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public/index.html")));
app.get("/dashboard", (_, res) => res.sendFile(path.join(__dirname, "public/dashboard.html")));
app.get("/pay.html", (_, res) => res.sendFile(path.join(__dirname, "public/pay.html")));

// 🔐 認証
app.post("/auth", (req, res) => {
  const { code } = req.body;
  if (code === process.env.ACCESS_CODE) {
    res.redirect("/index.html");
  } else {
    res.send("<h2>パスコードが違います。<a href='/'>戻る</a></h2>");
  }
});

// QRコード読み取り用エンドポイント（固定URL）
// ======== QR読み取りで解答権付与 ========
app.post("/claim-quiz", (req, res) => {
  const { nickname, quizId } = req.body;  // JSONから取得

  const db = loadDB();
  if (!db[nickname]) return res.status(404).json({ error: "ユーザーが存在しません" });

  db[nickname].quizRights = db[nickname].quizRights || {};
  if (db[nickname].quizRights[quizId]) {
    return res.json({ message: `すでに ${quizId} の解答権を持っています` });
  }

  db[nickname].quizRights[quizId] = true;
  safeSaveDB(db);
  res.json({ message: `${quizId} の解答権を取得しました！` });
});


// 👤 ログイン
app.post("/login", (req, res) => {
  let { nickname, adminCode, accessCode } = req.body;

  // アクセスコードチェック
  if (accessCode !== process.env.ACCESS_CODE) {
    return res.json({ error: "アクセスコードが無効です" });
  }

  // 管理者判定
  const isAdmin = adminCode && adminCode === process.env.ADMIN_CODE;

  // 管理者コードが入力されているのに正しくない場合は拒否
  if (adminCode && !isAdmin) {
    return res.json({ error: "管理者コードが無効です" });
  }

  // 管理者は nickname を "admin" 固定
  const finalNickname = isAdmin ? "admin" : nickname;

  // 一般ユーザーの場合ニックネームの妥当性をチェック
  if (!isAdmin && !validateNickname(finalNickname)) {
    return res.json({ error: "無効なニックネームです" });
  }

  const db = loadDB();

// ユーザー登録
if (!db[finalNickname]) {
  db[finalNickname] = { 
    balance: isAdmin ? 10000 : 100, 
    history: [], 
    isAdmin,
    quizRights: {} // ← デフォルトで解答権なし
  };
} else if (isAdmin) {
  db[finalNickname].isAdmin = true;
  db[finalNickname].balance = 10000;
  db[finalNickname].quizRights = db[finalNickname].quizRights || {};
}


  safeSaveDB(db);

  res.json({
    success: true,
    nickname: finalNickname,
    isAdmin,
    balance: db[finalNickname].balance
  });
});


// ======== 💰 残高取得 ========
app.get("/balance/:nickname", (req, res) => {
  const db = loadDB();
  const user = db[req.params.nickname];
  if (!user) return res.status(404).json({ error: "ユーザーが存在しません" });
  res.json({ balance: user.balance });
});

// ======== 🧩 クイズ報酬 ========
app.get("/quiz01.html", (req, res) => {
  const nickname = req.query.nickname;
  const db = loadDB();
  const user = db[nickname];
  if (!user || !user.quizRights.quiz01) {
    return res.send(`<script>alert("⚠️ このクイズの回答権がありません");window.location.href="/dashboard";</script>`);
  }
  res.sendFile(path.join(__dirname, "public/quiz01.html"));
});

app.get("/quiz02.html", (req, res) => {
  const nickname = req.query.nickname;
  const db = loadDB();
  const user = db[nickname];
  if (!user || !user.quizRights.quiz02) {
    return res.send(`<script>alert("⚠️ このクイズの回答権がありません");window.location.href="/dashboard";</script>`);
  }
  res.sendFile(path.join(__dirname, "public/quiz02.html"));
});

// quiz03〜quiz05も同様
app.get("/quiz03.html", (req, res) => {
  const nickname = req.query.nickname;
  const db = loadDB();
  const user = db[nickname];
  if (!user || !user.quizRights.quiz03) {
    return res.send(`<script>alert("⚠️ このクイズの回答権がありません");window.location.href="/dashboard";</script>`);
  }
  res.sendFile(path.join(__dirname, "public/quiz03.html"));
});

app.get("/quiz04.html", (req, res) => {
  const nickname = req.query.nickname;
  const db = loadDB();
  const user = db[nickname];
  if (!user || !user.quizRights.quiz04) {
    return res.send(`<script>alert("⚠️ このクイズの回答権がありません");window.location.href="/dashboard";</script>`);
  }
  res.sendFile(path.join(__dirname, "public/quiz04.html"));
});

app.get("/quiz05.html", (req, res) => {
  const nickname = req.query.nickname;
  const db = loadDB();
  const user = db[nickname];
  if (!user || !user.quizRights.quiz05) {
    return res.send(`<script>alert("⚠️ このクイズの回答権がありません");window.location.href="/dashboard";</script>`);
  }
  res.sendFile(path.join(__dirname, "public/quiz05.html"));
});

// ======== 🎯 クエスト報酬 ========
app.post("/quest", async (req, res) => {
  const { nickname, amount, type, questId } = req.body;
  const db = loadDB();

  if (!db[nickname]) return res.status(404).json({ error: "ユーザーが存在しません" });
  if (questId && db[nickname].history.some(h => h.questId === questId))
    return res.json({ message: "すでにクリア済み" });

  const reward = Number(amount);
  if (reward <= 0) return res.status(400).json({ error: "無効な報酬額" });

  db[nickname].balance += reward;
  db[nickname].history.push({
    type: type || "クエスト報酬",
    questId,
    amount: reward,
    date: new Date(),
  });
  safeSaveDB(db);
  io.emit("update");
  res.json({ balance: db[nickname].balance });
});
// ユーザー存在確認
app.get("/user-exists/:nickname", (req, res) => {
  const db = loadDB();
  const nickname = req.params.nickname;
  res.json({ exists: !!db[nickname] });
});

// ======== 🔄 送金 ========
app.post("/send", (req, res) => {
  const { from, to, amount } = req.body;
  const db = loadDB();

  if (!db[from] || !db[to]) return res.status(400).json({ error: "ユーザーが存在しません" });
  if (!db[from].isAdmin && db[from].balance < amount) return res.status(400).json({ error: "残高不足" });

  const amt = Number(amount);
  const date = new Date().toISOString();

  if (!db[from].isAdmin) db[from].balance -= amt;
  db[to].balance += amt;

  db[from].history.push({ type: "送金", to, amount: amt, date });
  db[to].history.push({ type: "受取", from, amount: amt, date });

  safeSaveDB(db);
  io.emit("update");
  res.json({ success: true, balance: db[from].balance });
});

// ======== 🧾 QRコード生成 ========
app.get("/generate-qr/:nickname/:amount", async (req, res) => {
  const { nickname, amount } = req.params;
  if (!nickname || !amount) return res.status(400).json({ error: "不足情報" });

  try {
    const qrUrl = `https://ncoin-barky.onrender.com/claim-quiz.html?quizId=${quizId}`;
    const qr = await QRCode.toDataURL(qrUrl);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ error: "QR生成失敗", detail: err.message });
  }
});

// ======== 🏆 ランキング ========
app.get("/ranking", (req, res) => {
  const db = loadDB();
  const ranking = Object.entries(db)
    .filter(([_, data]) => !data.isAdmin)
    .sort((a, b) => b[1].balance - a[1].balance)
    .map(([name, data]) => ({ nickname: name, balance: data.balance }));

  res.json(ranking);
});

// ======== 📜 履歴 ========
app.get("/history/:nickname", (req, res) => {
  const db = loadDB();
  const user = db[req.params.nickname];
  if (!user) return res.status(404).json({ error: "ユーザーが存在しません" });
  res.json(user.history);
});

// ======== 🧭 管理者用API ========

// 管理者認証
function checkAdmin(req, res, next) {
  const { adminCode } = req.body;
  if (adminCode !== process.env.ADMIN_CODE) {
    return res.status(403).json({ error: "管理者コードが無効です" });
  }
  next();
}

// 🪙 全員にコイン配布
app.post("/admin/distribute", checkAdmin, async (req, res) => {
  const { amount } = req.body;
  const reward = Number(amount);
  if (!Number.isFinite(reward) || reward <= 0) {
    return res.status(400).json({ error: "無効な金額です" });
  }

  const db = loadDB();
  Object.keys(db).forEach(name => {
    if (!db[name].isAdmin) {
      db[name].balance += reward;
      db[name].history.push({ type: "全体配布", amount: reward, date: new Date().toISOString() });
    }
  });

  safeSaveDB(db);
  io.emit("update");
  res.json({ message: `全ユーザーに ${reward} コイン配布完了` });
});

// ❌ 特定ユーザー削除
app.post("/admin/delete", checkAdmin, async (req, res) => {
  const { target } = req.body;
  const db = loadDB();

  if (!db[target]) return res.status(404).json({ error: "指定されたユーザーが存在しません" });

  delete db[target];
  safeSaveDB(db);
  io.emit("update");
  res.json({ message: `ユーザー '${target}' を削除しました` });
});

// ======== ⚡ Socket.io ========
io.on("connection", (socket) => {
  console.log("✅ クライアント接続");
});

// ======== サーバ起動 ========
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
