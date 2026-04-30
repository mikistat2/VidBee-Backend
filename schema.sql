-- VidBee Database Schema
-- Run this against your PostgreSQL database to create all required tables.
-- Usage: psql -U postgres -d vidbee -f schema.sql

-- ─── Users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  first_name    VARCHAR(100)  NOT NULL,
  last_name     VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  NOT NULL UNIQUE,
  password      VARCHAR(255)  NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Uploads ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploads (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name       VARCHAR(500)  NOT NULL,
  file_size       INTEGER       NOT NULL,
  file_type       VARCHAR(10)   NOT NULL,
  extracted_text  TEXT,
  status          VARCHAR(20)   NOT NULL DEFAULT 'processing',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id);

-- ─── Questions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS questions (
  id            SERIAL PRIMARY KEY,
  upload_id     INTEGER       NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  user_id       INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question      TEXT          NOT NULL,
  options       JSONB         NOT NULL,
  answer        TEXT          NOT NULL,
  explanation   JSONB,
  difficulty    VARCHAR(20)   NOT NULL DEFAULT 'medium',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_questions_upload ON questions(upload_id);

-- Backfill / migration helper for existing databases
-- (Safe to re-run: uses IF NOT EXISTS)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation JSONB;

-- ─── Quiz Sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  upload_id     INTEGER       NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  config        JSONB         NOT NULL DEFAULT '{}',
  score         INTEGER,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON quiz_sessions(user_id);

-- ─── Answers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS answers (
  id              SERIAL PRIMARY KEY,
  session_id      INTEGER       NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_id     INTEGER       NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_answer TEXT          NOT NULL,
  is_correct      BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
