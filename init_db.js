/**
 * init_db.js
 * - server 起動前に一度実行して schema を作成します
 * - 実行: node init_db.js
 * - 環境変数 DATABASE_URL を使用します（Render の環境変数をそのまま利用可能）
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL が設定されていません');
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error('ERROR: schema.sql が見つかりません。schema.sql を同ディレクトリに置いてください。');
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = new Client({
    connectionString: dbUrl,
    // Render / many hosts require SSL. 必要に応じて adjust:
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to DB. Running schema...');
    await client.query(sql);
    console.log('✅ Schema applied successfully');
  } catch (err) {
    console.error('Schema apply error:', err);
    process.exitCode = 2;
  } finally {
    await client.end().catch(()=>{});
  }
}

if (require.main === module) {
  run();
}

module.exports = run;