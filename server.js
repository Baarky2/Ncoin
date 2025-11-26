/**
 * 🚀 Improved Ncoin Server
 * 高速キャッシュ + 安全書き込み + 管理者権限対応版
 */

const express = require("express");
const fs = require("fs");
const QRCode = require("qrcode");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
require("dotenv").config();
const app = express();
const path = require("path");

app.use(express.static("public")); // OK
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE;
const ADMIN_CODE = process.env.ADMIN_CODE || "Z4kL8PqR9"; // 管理者コード

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));
app.use(express.static(path.join(__dirname, "public")));

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
// ======== 📝 安全保存関数 ========
function safeSaveDB(db) {
  dbCache = db;
  dirty = true;

  // 保存の間隔をあける（高速連続書き込み防止）
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DB_FILE, JSON.stringify(dbCache, null, 2), (err) => {
      if (err) console.error("DB保存失敗:", err);
      else console.log("✅ DB保存完了");
      dirty = false;
    });
  }, 100); // 100ms後に書き込み
}

// 共通定数
const NORMAL_QUIZZES = ["quiz01", "quiz02", "quiz03", "quiz04", "quiz05"];
const EX_QUIZZES = ["ex01", "ex02", "ex03", "ex04", "ex05", "ex06", "ex07"];

// クイズ権限チェック
app.get("/quiz-rights/:nickname", (req, res) => {
  const db = loadDB();
  const user = db[req.params.nickname];
  if (!user) return res.status(404).json({ error: "ユーザーが存在しません" });

  user.history = user.history || [];
  user.quizRights = user.quizRights || {};

  // ノーマルクイズの正解済みID（履歴ベース）
  const clearedNormal = user.history
    .map(h => h.questId)
    .filter(id => id && NORMAL_QUIZZES.includes(id));

  // すべて正解済みかチェック（履歴にあるものが「回答済み」）
  const allNormalCleared = NORMAL_QUIZZES.every(q => clearedNormal.includes(q));

  let exQuizRights = {};
  if (allNormalCleared) {
    // ノーマルをすべて回答済みなら EX を解放（仕様に合わせて一括解放）
    EX_QUIZZES.forEach(id => {
      // フロント側では exQuizRights[id] が true なら表示・押下可能にする
      exQuizRights[id] = true;
    });
  } else {
    // まだノーマル全クリでない → EX は非表示/非解放
    exQuizRights = {};
  }

  // ただし既に user.quizRights に設定がある場合はそれも反映（過去に個別に付与されていれば true）
  EX_QUIZZES.forEach(id => {
    if (user.quizRights[id]) exQuizRights[id] = true;
  });

  res.json({ quizRights: user.quizRights, exQuizRights });
});


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
  const {
    code
  } = req.body;
  if (code === process.env.ACCESS_CODE) {
    res.redirect("/index.html");
  } else {
    res.send("<h2>パスコードが違います。<a href='/'>戻る</a></h2>");
  }
});

// QRコード読み取り用エンドポイント（固定URL）
// ======== QR読み取りで解答権付与 ========
app.post("/claim-quiz", (req, res) => {
  const { nickname, quizId } = req.body;
  const db = loadDB();
  if (!db[nickname]) return res.status(404).json({ error: "ユーザーが存在しません" });

  db[nickname].quizRights = db[nickname].quizRights || {};

  if (db[nickname].quizRights[quizId]) {
    return res.json({ message: `すでに ${quizId} の解答権を持っています`, exUnlocked: false });
  }

  // 解答権を付与（QRでの取得は「回答権付与」のみ）
  db[nickname].quizRights[quizId] = true;

  safeSaveDB(db);

  // ※ EX の解放は「実際に回答して /quest で履歴が入ったとき」に判定する仕様に変更。
  res.json({
    message: `${quizId} の解答権を取得しました！`,
    exUnlocked: false
  });
});


// 👤 ログイン
app.post("/login", (req, res) => {
  let {
    nickname,
    adminCode,
    accessCode
  } = req.body;

  // アクセスコードチェック
  if (accessCode !== process.env.ACCESS_CODE) {
    return res.json({
      error: "アクセスコードが無効です"
    });
  }

  // 管理者判定
  const isAdmin = adminCode && adminCode === process.env.ADMIN_CODE;

  // 管理者コードが入力されているのに正しくない場合は拒否
  if (adminCode && !isAdmin) {
    return res.json({
      error: "管理者コードが無効です"
    });
  }

  // 管理者は nickname を "admin" 固定
  const finalNickname = isAdmin ? "admin" : nickname;

  // 一般ユーザーの場合ニックネームの妥当性をチェック
  if (!isAdmin && !validateNickname(finalNickname)) {
    return res.json({
      error: "無効なニックネームです"
    });
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
  if (!user) return res.status(404).json({
    error: "ユーザーが存在しません"
  });
  res.json({
    balance: user.balance
  });
});

// ======== 🧩 クイズ報酬（各 quiz ページへのアクセス制御） ========
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

// EX_quiz pages (例: public/EX_quiz01.html ... EX_quiz07.html)
// ルーティングが必要ならここに同様の GET ハンドラを追加してください。
// 例:
// app.get("/EX_quiz01.html", (req, res) => { ... });

// ======== 🎯 クエスト報酬 ========
app.post("/quest", async (req, res) => {
  const {
    nickname,
    amount,
    type,
    questId
  } = req.body;
  const db = loadDB();

  const user = db[nickname];
  if (!user) return res.status(404).json({
    error: "ユーザーが存在しません"
  });

  user.history = user.history || [];
  user.quizRights = user.quizRights || {};

  // すでに同じ questId をクリア済みなら何もしない
  if (questId && user.history.some(h => h.questId === questId)) {
    return res.json({ message: "すでにクリア済み" });
  }

  const reward = Number(amount);
  if (reward <= 0) return res.status(400).json({
    error: "無効な報酬額"
  });

  // 🔹 コイン加算と履歴追加
  user.balance += reward;
  user.history.push({
    type: type || "クエスト報酬",
    questId,
    amount: reward,
    date: new Date().toISOString(),
  });

  // 🔹 解答権の管理（quizRights）
  if (questId && questId.startsWith("quiz")) {
    user.quizRights[questId] = true;
  } else if (questId && questId.startsWith("ex")) {
    // EX は既にクライアントが持っている回答権でページに入っているはずなので、
    // ここでは履歴としてクリア済み扱いにするだけで OK（権利は残す／または必要なら消す）
    user.quizRights[questId] = true;
  }

  // 🔹 ノーマル問題全クリ（履歴ベース）判定
  const clearedNormal = user.history.map(h => h.questId).filter(id => id && NORMAL_QUIZZES.includes(id));
  const allNormalCleared = NORMAL_QUIZZES.every(q => clearedNormal.includes(q));

  // 🔹 EX問題解放ロジック（ノーマルを全て回答済みになったときに一括解放）
  let exUnlocked = false;
  if (allNormalCleared) {
    EX_QUIZZES.forEach(id => {
      if (!user.quizRights[id]) {
        user.quizRights[id] = true;
        exUnlocked = true;
      }
    });
  }

  // 🔹 EX個別クリア時の「全EXクリアボーナス」(重複防止)
  if (questId && questId.startsWith("ex")) {
    // EX が全部クリア済みかをチェック（履歴ベース）
    const clearedEx = user.history.map(h => h.questId).filter(id => id && EX_QUIZZES.includes(id));
    const allExCleared = EX_QUIZZES.every(id => clearedEx.includes(id));
    if (allExCleared) {
      // bonus_ex_all をまだもらっていなければ付与
      const alreadyGotExBonus = user.history.some(h => h.questId === "bonus_ex_all");
      if (!alreadyGotExBonus) {
        const bonusAmount = 400;
        user.balance += bonusAmount;
        user.history.push({
          type: "全EXクリアボーナス",
          questId: "bonus_ex_all",
          amount: bonusAmount,
          date: new Date().toISOString(),
        });
      }
    }
  }

  safeSaveDB(db);
  io.emit("update");

  res.json({
    balance: user.balance,
    exUnlocked,
  });
});

// ユーザー存在確認
app.get("/user-exists/:nickname", (req, res) => {
  const db = loadDB();
  const nickname = req.params.nickname;
  res.json({
    exists: !!db[nickname]
  });
});

// ======== 🔄 送金 ========
app.post("/send", (req, res) => {
  const {
    from,
    to,
    amount
  } = req.body;
  const db = loadDB();

  if (!db[from] || !db[to]) return res.status(400).json({
    error: "ユーザーが存在しません"
  });
  if (!db[from].isAdmin && db[from].balance < amount) return res.status(400).json({
    error: "残高不足"
  });

  const amt = Number(amount);
  const date = new Date().toISOString();

  if (!db[from].isAdmin) db[from].balance -= amt;
  db[to].balance += amt;

  db[from].history.push({
    type: "送金",
    to,
    amount: amt,
    date
  });
  db[to].history.push({
    type: "受取",
    from,
    amount: amt,
    date
  });

  safeSaveDB(db);
  io.emit("update");
  res.json({
    success: true,
    balance: db[from].balance
  });
});

// ======== 🧾 QRコード生成 ========
app.get("/generate-qr/:nickname/:quizId", async (req, res) => {
  const {
    nickname,
    quizId
  } = req.params;
  if (!nickname || !quizId) return res.status(400).json({
    error: "不足情報"
  });

  try {
    const qrUrl = `https://ncoin-barky.onrender.com/claim-quiz.html?nickname=${encodeURIComponent(nickname)}&quizId=${encodeURIComponent(quizId)}`;
    const qr = await QRCode.toDataURL(qrUrl);
    res.json({
      qr
    });
  } catch (err) {
    res.status(500).json({
      error: "QR生成失敗",
      detail: err.message
    });
  }
});


// ======== 🏆 ランキング ========
app.get("/ranking", (req, res) => {
  const db = loadDB();
  const ranking = Object.entries(db)
    .filter(([_, data]) => !data.isAdmin)
    .sort((a, b) => b[1].balance - a[1].balance)
    .map(([name, data]) => ({
      nickname: name,
      balance: data.balance
    }));

  res.json(ranking);
});

// ======== 📜 履歴 ========
app.get("/history/:nickname", (req, res) => {
  const db = loadDB();
  const user = db[req.params.nickname];
  if (!user) return res.status(404).json({
    error: "ユーザーが存在しません"
  });
  user.history = user.history || [];
  res.json(user.history);
});

// ======== 🧭 管理者用API ========

// 管理者認証
function checkAdmin(req, res, next) {
  const {
    adminCode
  } = req.body;
  if (adminCode !== process.env.ADMIN_CODE) {
    return res.status(403).json({
      error: "管理者コードが無効です"
    });
  }
  next();
}

// 🪙 全員にコイン配布
app.post("/admin/distribute", checkAdmin, async (req, res) => {
  const {
    amount
  } = req.body;
  const reward = Number(amount);
  if (!Number.isFinite(reward) || reward <= 0) {
    return res.status(400).json({
      error: "無効な金額です"
    });
  }

  const db = loadDB();
  Object.keys(db).forEach(name => {
    if (!db[name].isAdmin) {
      db[name].balance += reward;
      db[name].history.push({
        type: "全体配布",
        amount: reward,
        date: new Date().toISOString()
      });
    }
  });

  safeSaveDB(db);
  io.emit("update");
  res.json({
    message: `全ユーザーに ${reward} コイン配布完了`
  });
});

// ❌ 特定ユーザー削除
app.post("/admin/delete", checkAdmin, async (req, res) => {
  const {
    target
  } = req.body;
  const db = loadDB();

  if (!db[target]) return res.status(404).json({
    error: "指定されたユーザーが存在しません"
  });

  delete db[target];
  safeSaveDB(db);
  io.emit("update");
  res.json({
    message: `ユーザー '${target}' を削除しました`
  });
});

// ======== ⚡ Socket.io ========
io.on("connection", (socket) => {
  if (process.env.NODE_ENV !== "production") {
    console.log("✅ クライアント接続");
  }
});
app.get("/health", (_, res) => res.send("OK"));


// ======== サーバ起動 ========
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
