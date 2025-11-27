/**
 * 🚀 Ncoin Server — PostgreSQL版
 * 高速キャッシュ + 安全書き込み → Postgres に一本化した実装
 *
 * 環境変数:
 * - DATABASE_URL
 * - ACCESS_CODE
 * - ADMIN_CODE
 * - PORT (任意)
 *
 * 必要なテーブルは schema.sql を参照してください。
 */

const express = require("express");
const QRCode = require("qrcode");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
require("dotenv").config();
const app = express();
const path = require("path");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const ACCESS_CODE = process.env.ACCESS_CODE;
const ADMIN_CODE = process.env.ADMIN_CODE || "Z4kL8PqR9";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = socketIo(server);

// 共通定数
const NORMAL_QUIZZES = ["quiz01", "quiz02", "quiz03", "quiz04", "quiz05"];
const EX_QUIZZES = ["ex01", "ex02", "ex03", "ex04", "ex05", "ex06", "ex07"];

// ======== ユーティリティ ========
function validateNickname(name) {
  return typeof name === "string" && /^[\p{L}\p{N}_-]{1,20}$/u.test(name);
}

async function userExists(nickname) {
  const r = await pool.query("SELECT 1 FROM users WHERE nickname = $1 LIMIT 1", [nickname]);
  return r.rowCount > 0;
}

// ======== ルート ========
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/dashboard", (_, res) => res.sendFile(path.join(__dirname, "public/dashboard.html")));
app.get("/pay.html", (_, res) => res.sendFile(path.join(__dirname, "public/pay.html")));
app.get("/public/ex_quiz01.png", (_, res) => res.sendFile(path.join(__dirname, "public/EX_quiz01.png")));
app.get("/public/ex_quiz02.png", (_, res) => res.sendFile(path.join(__dirname, "public/EX_quiz02.png")));
app.get("/public/ex_quiz03.png", (_, res) => res.sendFile(path.join(__dirname, "public/EX_quiz03.png")));
app.get("/public/ex_quiz04.png", (_, res) => res.sendFile(path.join(__dirname, "public/EX_quiz04.png")));
app.get("/public/ex_quiz05.png", (_, res) => res.sendFile(path.join(__dirname, "public/EX_quiz05.png")));
app.get("/public/ex_quiz06.png", (_, res) => res.sendFile(path.join(__dirname, "public/EX_quiz06.png")));
app.get("/public/ex_quiz07.png", (_, res) => res.sendFile(path.join(__dirname, "public/EX_quiz07.png")));

app.get("/favicon.ico", (req, res) => res.status(204).end());

// ======== 認証ページ（旧） ========
app.post("/auth", (req, res) => {
  const { code } = req.body;
  if (code === ACCESS_CODE) {
    res.redirect("/index.html");
  } else {
    res.send("<h2>パスコードが違います。<a href='/'>戻る</a></h2>");
  }
});

// ======== クイズ権限チェック（Postgres版） ========
app.get("/quiz-rights/:nickname", async (req, res) => {
  const nickname = req.params.nickname;
  try {
    const userR = await pool.query("SELECT nickname FROM users WHERE nickname = $1", [nickname]);
    if (userR.rowCount === 0) return res.status(404).json({ error: "ユーザーが存在しません" });

    // 現状付与されている quiz rights を取得
    const qr = await pool.query("SELECT quest_id FROM quiz_rights WHERE nickname = $1", [nickname]);
    const quizRightsArr = qr.rows.map(r => r.quest_id);

    // 履歴からノーマルクリア状況を取得
    const histR = await pool.query(
      "SELECT quest_id FROM history WHERE nickname = $1 AND quest_id = ANY($2::text[])",
      [nickname, NORMAL_QUIZZES]
    );
    const clearedNormalIds = histR.rows.map(r => r.quest_id);
    const allNormalCleared = NORMAL_QUIZZES.every(id => clearedNormalIds.includes(id));

    // ex 解放情報を返す（フロント用途）
    const exQuizRights = {};
    if (allNormalCleared) {
      EX_QUIZZES.forEach(id => exQuizRights[id] = true);
    }
    // 既に個別に権利があれば反映
    quizRightsArr.forEach(id => {
      if (EX_QUIZZES.includes(id)) exQuizRights[id] = true;
    });

    res.json({
      quizRights: quizRightsArr, // 既に付与済みのリスト
      exQuizRights
    });
  } catch (err) {
    console.error("quiz-rights error:", err);
    res.status(500).json({ error: "database error" });
  }
});

// ======== QR読み取りで解答権付与（Postgres） ========
app.post("/claim-quiz", async (req, res) => {
  const { nickname, quizId } = req.body;
  if (!nickname || !quizId) return res.status(400).json({ error: "不足情報" });

  try {
    const exists = await userExists(nickname);
    if (!exists) return res.status(404).json({ error: "ユーザーが存在しません" });

    await pool.query(
      `INSERT INTO quiz_rights (nickname, quest_id)
       VALUES ($1, $2)
       ON CONFLICT (nickname, quest_id) DO NOTHING`,
      [nickname, quizId]
    );

    res.json({
      message: `${quizId} の解答権を取得しました！`,
      exUnlocked: false
    });
  } catch (err) {
    console.error("claim-quiz error:", err);
    res.status(500).json({ error: "database error" });
  }
});

// ======== ログイン / 新規登録（Postgres） ========
app.post("/login", async (req, res) => {
  let { nickname, password, adminCode } = req.body;

  try {
    // 管理者ログイン
    const isAdmin = adminCode && adminCode === ADMIN_CODE;
    if (adminCode && !isAdmin) {
      return res.json({ error: "管理者コードが無効です" });
    }

    if (isAdmin) {
      nickname = "admin";
      const existing = await pool.query("SELECT nickname FROM users WHERE nickname = $1", [nickname]);
      if (existing.rowCount === 0) {
        await pool.query(
          `INSERT INTO users (nickname, password, balance, is_admin)
           VALUES ($1, NULL, 10000, true)`,
          [nickname]
        );
      } else {
        await pool.query(
          `UPDATE users SET is_admin = true, balance = 10000 WHERE nickname = $1`,
          [nickname]
        );
      }

      return res.json({
        success: true,
        nickname,
        isAdmin: true,
        balance: 10000
      });
    }

    // 一般ユーザー
    if (!nickname) return res.json({ error: "ニックネームを入力してください" });
    if (!password) return res.json({ error: "パスワードを入力してください" });
    if (!validateNickname(nickname)) return res.json({ error: "無効なニックネームです" });

    const r = await pool.query("SELECT nickname, password, balance FROM users WHERE nickname = $1", [nickname]);
    if (r.rowCount === 0) {
      // 新規登録
      const hashedPass = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO users (nickname, password, balance, is_admin)
         VALUES ($1, $2, 0, false)`,
        [nickname, hashedPass]
      );

      return res.json({
        success: true,
        nickname,
        isAdmin: false,
        balance: 0
      });
    }

    const user = r.rows[0];
    if (!user.password) {
      return res.json({ error: "このユーザーはパスワード未設定です" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ error: "パスワードが間違っています" });

    return res.json({
      success: true,
      nickname,
      isAdmin: false,
      balance: user.balance
    });

  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ error: "database error" });
  }
});

// ======== 残高取得 ========
app.get("/balance/:nickname", async (req, res) => {
  try {
    const nickname = req.params.nickname;
    const r = await pool.query("SELECT balance FROM users WHERE nickname = $1", [nickname]);
    if (r.rowCount === 0) return res.status(404).json({ error: "ユーザーが存在しません" });
    res.json({ balance: r.rows[0].balance });
  } catch (err) {
    console.error("balance error:", err);
    res.status(500).json({ error: "database error" });
  }
});

// ======== クイズページアクセス制御（例: quiz01..quiz05） ========
async function serveQuizPage(req, res, quizId, pageFile) {
  const nickname = req.query.nickname;
  if (!nickname) return res.send(`<script>alert("⚠️ ニックネームが指定されていません");window.location.href="/dashboard";</script>`);

  try {
    const r = await pool.query(
      "SELECT 1 FROM quiz_rights WHERE nickname = $1 AND quest_id = $2 LIMIT 1",
      [nickname, quizId]
    );
    if (r.rowCount === 0) {
      return res.send(`<script>alert("⚠️ このクイズの回答権がありません");window.location.href="/dashboard";</script>`);
    }
    res.sendFile(path.join(__dirname, "public", pageFile));
  } catch (err) {
    console.error("serveQuizPage error:", err);
    res.status(500).send("server error");
  }
}

app.get("/quiz01.html", (req, res) => serveQuizPage(req, res, "quiz01", "quiz01.html"));
app.get("/quiz02.html", (req, res) => serveQuizPage(req, res, "quiz02", "quiz02.html"));
app.get("/quiz03.html", (req, res) => serveQuizPage(req, res, "quiz03", "quiz03.html"));
app.get("/quiz04.html", (req, res) => serveQuizPage(req, res, "quiz04", "quiz04.html"));
app.get("/quiz05.html", (req, res) => serveQuizPage(req, res, "quiz05", "quiz05.html"));
// EX クイズページは必要なら同様に追加してください

// ======== クエスト報酬 ========
// 既存コード基に Postgres トランザクションを使用して安全に処理
app.post("/quest", async (req, res) => {
  const client = await pool.connect();
  try {
    const { nickname, questId, amount, type } = req.body;
    const reward = Number(amount);
    if (!nickname || !questId || !reward) return res.status(400).json({ error: "invalid params" });

    await client.query("BEGIN");

    const userR = await client.query("SELECT * FROM users WHERE nickname = $1 FOR UPDATE", [nickname]);
    if (userR.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ユーザーが存在しません" });
    }

    const cleared = await client.query(
      "SELECT 1 FROM history WHERE nickname = $1 AND quest_id = $2 LIMIT 1",
      [nickname, questId]
    );
    if (cleared.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.json({ message: "すでにクリア済み" });
    }

    await client.query("UPDATE users SET balance = balance + $1 WHERE nickname = $2", [reward, nickname]);

    await client.query(
      `INSERT INTO history (nickname, quest_id, amount, type)
       VALUES ($1, $2, $3, $4)`,
      [nickname, questId, reward, type || "クエスト報酬"]
    );

    // ノーマル全クリ判定
    const normalClear = await client.query(
      "SELECT quest_id FROM history WHERE nickname = $1 AND quest_id = ANY($2::text[])",
      [nickname, NORMAL_QUIZZES]
    );
    const clearedNormalIds = normalClear.rows.map(r => r.quest_id);
    const allNormalDone = NORMAL_QUIZZES.every(id => clearedNormalIds.includes(id));

    let exUnlocked = false;
    if (allNormalDone) {
      await client.query(
        `INSERT INTO quiz_rights (nickname, quest_id)
         SELECT $1, UNNEST($2::text[])
         ON CONFLICT DO NOTHING`,
        [nickname, EX_QUIZZES]
      );
      exUnlocked = true;
    }

    // EX個別クリア → 全EXクリアボーナス
    if (questId.startsWith("ex")) {
      const exClear = await client.query(
        "SELECT quest_id FROM history WHERE nickname = $1 AND quest_id = ANY($2::text[])",
        [nickname, EX_QUIZZES]
      );
      const clearedExIds = exClear.rows.map(r => r.quest_id);
      const allExDone = EX_QUIZZES.every(id => clearedExIds.includes(id));

      if (allExDone) {
        const bonus = await client.query(
          "SELECT 1 FROM history WHERE nickname = $1 AND quest_id = 'bonus_ex_all' LIMIT 1",
          [nickname]
        );
        if (bonus.rowCount === 0) {
          await client.query("UPDATE users SET balance = balance + 400 WHERE nickname = $1", [nickname]);
          await client.query(
            `INSERT INTO history (nickname, quest_id, amount, type)
             VALUES ($1, 'bonus_ex_all', 400, '全EXクリアボーナス')`,
            [nickname]
          );
        }
      }
    }

    await client.query("COMMIT");
    io.emit("update");
    res.json({ ok: true, exUnlocked });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("quest error:", err);
    res.status(500).json({ error: "database error" });
  } finally {
    client.release();
  }
});

// ======== 送金（Postgres トランザクション） ========
app.post("/send", async (req, res) => {
  const { from, to, amount } = req.body;
  const amt = Number(amount);
  if (!from || !to || !Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "invalid params" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const fromR = await client.query("SELECT balance, is_admin FROM users WHERE nickname = $1 FOR UPDATE", [from]);
    const toR = await client.query("SELECT balance FROM users WHERE nickname = $1 FOR UPDATE", [to]);

    if (fromR.rowCount === 0 || toR.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "ユーザーが存在しません" });
    }

    const fromUser = fromR.rows[0];
    const toUser = toR.rows[0];

    if (!fromUser.is_admin && Number(fromUser.balance) < amt) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "残高不足" });
    }

    if (!fromUser.is_admin) {
      await client.query("UPDATE users SET balance = balance - $1 WHERE nickname = $2", [amt, from]);
    }
    await client.query("UPDATE users SET balance = balance + $1 WHERE nickname = $2", [amt, to]);

    const date = new Date().toISOString();
    await client.query(
      `INSERT INTO history (nickname, quest_id, amount, type, created_at)
       VALUES ($1, NULL, $2, '送金', $3)`,
      [from, -amt, date]
    );
    await client.query(
      `INSERT INTO history (nickname, quest_id, amount, type, created_at)
       VALUES ($1, NULL, $2, '受取', $3)`,
      [to, amt, date]
    );

    await client.query("COMMIT");
    io.emit("update");

    const newFromBalR = await pool.query("SELECT balance FROM users WHERE nickname = $1", [from]);
    res.json({ success: true, balance: newFromBalR.rows[0].balance });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("send error:", err);
    res.status(500).json({ error: "database error" });
  } finally {
    client.release();
  }
});

// ======== QRコード生成 ========
app.get("/generate-qr/:nickname/:quizId", async (req, res) => {
  const { nickname, quizId } = req.params;
  if (!nickname || !quizId) return res.status(400).json({ error: "不足情報" });

  try {
    const base = process.env.BASE_URL || `https://ncoin-barky.onrender.com`;
    const qrUrl = `${base}/claim-quiz.html?nickname=${encodeURIComponent(nickname)}&quizId=${encodeURIComponent(quizId)}`;
    const qr = await QRCode.toDataURL(qrUrl);
    res.json({ qr });
  } catch (err) {
    console.error("generate-qr error:", err);
    res.status(500).json({ error: "QR生成失敗", detail: err.message });
  }
});

// ======== ランキング ========
app.get("/ranking", async (req, res) => {
  try {
    const r = await pool.query("SELECT nickname, balance FROM users WHERE NOT is_admin ORDER BY balance DESC");
    res.json(r.rows);
  } catch (err) {
    console.error("ranking error:", err);
    res.status(500).json({ error: "database error" });
  }
});

// ======== 履歴 ========
app.get("/history/:nickname", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT quest_id, amount, type, created_at AS date
       FROM history
       WHERE nickname = $1
       ORDER BY created_at ASC`,
      [req.params.nickname]
    );
    res.json(r.rows);
  } catch (err) {
    console.error("history error:", err);
    res.status(500).json({ error: "database error" });
  }
});

// ======== 管理者認証ミドルウェア ========
function checkAdmin(req, res, next) {
  const { adminCode } = req.body;
  if (adminCode !== ADMIN_CODE) {
    return res.status(403).json({ error: "管理者コードが無効です" });
  }
  next();
}

// ======== 管理者: 全員にコイン配布 ========
app.post("/admin/distribute", checkAdmin, async (req, res) => {
  const reward = Number(req.body.amount);
  if (!Number.isFinite(reward) || reward <= 0) return res.status(400).json({ error: "無効な金額です" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("UPDATE users SET balance = balance + $1 WHERE NOT is_admin", [reward]);

    await client.query(
      `INSERT INTO history (nickname, quest_id, amount, type)
       SELECT nickname, 'distribute', $1, '全体配布' FROM users WHERE NOT is_admin`,
      [reward]
    );

    await client.query("COMMIT");
    io.emit("update");
    res.json({ message: `全ユーザーに ${reward} コイン配布完了` });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("admin distribute error:", err);
    res.status(500).json({ error: "database error" });
  } finally {
    client.release();
  }
});

// ======== 管理者: ユーザー削除 ========
app.post("/admin/delete", checkAdmin, async (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ error: "target required" });

  try {
    const r = await pool.query("DELETE FROM users WHERE nickname = $1", [target]);
    if (r.rowCount === 0) return res.status(404).json({ error: "指定されたユーザーが存在しません" });
    io.emit("update");
    res.json({ message: `ユーザー '${target}' を削除しました` });
  } catch (err) {
    console.error("admin delete error:", err);
    res.status(500).json({ error: "database error" });
  }
});

// ======== ユーザー存在チェック（Postgres） ========
app.get("/user-exists/:nickname", async (req, res) => {
  try {
    const nickname = req.params.nickname;
    const result = await pool.query("SELECT 1 FROM users WHERE nickname = $1 LIMIT 1", [nickname]);
    res.json({ exists: result.rowCount > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "database error" });
  }
});

// ======== Socket.io ========
io.on("connection", (socket) => {
  if (process.env.NODE_ENV !== "production") {
    console.log("✅ クライアント接続");
  }
});

// ======== ヘルスチェック & サーバ起動 ========
app.get("/health", (_, res) => res.send("OK"));

const bindHost = process.env.BIND_HOST || "0.0.0.0";
const port = process.env.PORT || 3000;

(async () => {
  try {
    // マイグレーションを実行（schema.sql を適用）
    const runMigrations = require("./migrate_on_start");
    await runMigrations();
  } catch (err) {
    console.error("Migration failed (continuing startup):", err);
  }

  const bindHost = process.env.BIND_HOST || "0.0.0.0";
  const port = process.env.PORT || 3000;
  server.listen(port, bindHost, () => {
    console.log(`🚀 Server running on ${bindHost}:${port}`);
    if (process.env.NODE_ENV !== "production") {
      console.log("DATABASE_URL:", !!process.env.DATABASE_URL ? "(present)" : "(missing)");
    }
  });
})();