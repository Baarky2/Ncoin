-- PostgreSQL schema for Ncoin (users, history, quiz_rights)
-- 実行例: psql $DATABASE_URL -f schema.sql

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  nickname TEXT PRIMARY KEY,
  password TEXT,
  balance BIGINT DEFAULT 0,
  is_admin BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS history (
  id SERIAL PRIMARY KEY,
  nickname TEXT REFERENCES users(nickname) ON DELETE CASCADE,
  quest_id TEXT,
  amount BIGINT,
  type TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_rights (
  nickname TEXT REFERENCES users(nickname) ON DELETE CASCADE,
  quest_id TEXT,
  PRIMARY KEY (nickname, quest_id)
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_history_nickname ON history(nickname);
CREATE INDEX IF NOT EXISTS idx_history_questid ON history(quest_id);

COMMIT;