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
    res.redirect("/login.html");
  } else {
    res.send("<h2>パスコードが違います。<a href='/'>戻る</a></h2>");
  }
});

// 👤 ログイン
app.post("/login", (req, res) => {
  const { nickname, adminCode, accessCode } = req.body;

  // アクセスコードチェック
  if (accessCode !== process.env.ACCESS_CODE) {
    return res.json({ error: "アクセスコードが無効です" });
  }

  const db = loadDB();
  const isAdmin = adminCode === process.env.ADMIN_CODE;

  let finalNickname = nickname;

  // 管理者なら nickname を "admin" 固定
  if (isAdmin) finalNickname = "admin";

  if (!isAdmin && !validateNickname(finalNickname)) {
    return res.json({ error: "無効なニックネームです" });
  }

  // ユーザー登録
  if (!db[finalNickname]) {
    db[finalNickname] = { balance: isAdmin ? 10000 : 100, history: [], isAdmin };
  } else if (isAdmin) {
    db[finalNickname].isAdmin = true;
    db[finalNickname].balance = 10000;
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
app.post("/quiz01", async (req, res) => {
  const { nickname, answer } = req.body;
  const correct = "フルーツ";

  if (answer !== correct) return res.status(400).json({ error: "不正解です" });

  const db = loadDB();
  if (!db[nickname]) return res.status(404).json({ error: "ユーザーが存在しません" });

  const reward = 30;
  db[nickname].balance += reward;
  db[nickname].history.push({ type: "クイズ報酬", amount: reward, date: new Date() });
  safeSaveDB(db);
  io.emit("update");

  res.json({ balance: db[nickname].balance });
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
    const qrUrl = `${req.protocol}://${req.get("host")}/pay.html?from=${encodeURIComponent(nickname)}&amount=${encodeURIComponent(amount)}`;
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
