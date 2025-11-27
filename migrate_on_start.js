/**
 * migrate_on_start.js
 * - 起動時に schema.sql を読み込んで DB に適用します（IF NOT EXISTS の DDL を実行）
 * - Render の無料プラン等で Shell に入れない場合でも、デプロイ後の最初の起動でテーブルが作られます
 *
 * 注意:
 * - DATABASE_URL が正しい外部アクセス可能な接続文字列であることを必ず確認してください。
 * - schema.sql（リポジトリ内）が存在する前提です（既に repo にあります）。
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.warn("migrate_on_start: DATABASE_URL が設定されていません。スキップします。");
    return;
  }

  const sqlPath = path.join(__dirname, "schema.sql");
  if (!fs.existsSync(sqlPath)) {
    console.warn("migrate_on_start: schema.sql が見つかりません。スキップします。");
    return;
  }

  const sql = fs.readFileSync(sqlPath, "utf8");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // 多くのマネージド DB は SSL が必要です。必要に応じて変更してください。
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  try {
    console.log("migrate_on_start: Running schema.sql ...");
    // schema.sql 全体を一回のクエリで投げる（BEGIN/COMMITを含めている場合も想定）
    await client.query(sql);
    console.log("migrate_on_start: Schema applied (or already present).");
  } catch (err) {
    console.error("migrate_on_start: Schema apply error:", err);
    // エラーでも起動を止めない方針（必要なら throw して起動失敗にする）
    // throw err;
  } finally {
    client.release();
    await pool.end().catch(()=>{});
  }
}

// export 関数
module.exports = runMigrations;