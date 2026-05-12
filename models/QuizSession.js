// QuizSession model — tracks each quiz attempt by a user

import db from "../config/db.js";

// ─── Create ────────────────────────────────────────────────────────────────────

export async function createSession({ userId, uploadId, sharedQuizId = null, config = {}, shareToken }) {
  const result = await db.query(
    `INSERT INTO quiz_sessions (user_id, upload_id, shared_quiz_id, config, share_token)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, upload_id, shared_quiz_id, config, share_token, score, created_at`,
    [userId, uploadId, sharedQuizId, JSON.stringify(config), shareToken ?? null]
  );
  return result.rows[0];
}

// ─── Read ──────────────────────────────────────────────────────────────────────

export async function getSessionById(id) {
  const result = await db.query(
    `SELECT
       s.id, s.user_id, s.upload_id, s.shared_quiz_id, s.config, s.share_token, s.score, s.created_at,
       u.file_name AS upload_name,
       sq.token AS shared_quiz_token,
       sq.option_seed AS shared_quiz_option_seed
     FROM quiz_sessions s
     JOIN uploads u ON u.id = s.upload_id
     LEFT JOIN shared_quizzes sq ON sq.id = s.shared_quiz_id
     WHERE s.id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
  };
}

export async function getSessionByShareToken(shareToken) {
  const result = await db.query(
    `SELECT
       s.id, s.user_id, s.upload_id, s.shared_quiz_id, s.config, s.share_token, s.score, s.created_at,
       u.file_name AS upload_name,
       sq.token AS shared_quiz_token,
       sq.option_seed AS shared_quiz_option_seed
     FROM quiz_sessions s
     JOIN uploads u ON u.id = s.upload_id
     LEFT JOIN shared_quizzes sq ON sq.id = s.shared_quiz_id
     WHERE s.share_token = $1`,
    [shareToken]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
  };
}

export async function getSessionByUserAndSharedQuizId(userId, sharedQuizId) {
  const result = await db.query(
    `SELECT
       s.id, s.user_id, s.upload_id, s.shared_quiz_id, s.config, s.share_token, s.score, s.created_at,
       u.file_name AS upload_name,
       sq.token AS shared_quiz_token,
       sq.option_seed AS shared_quiz_option_seed
     FROM quiz_sessions s
     JOIN uploads u ON u.id = s.upload_id
     LEFT JOIN shared_quizzes sq ON sq.id = s.shared_quiz_id
     WHERE s.user_id = $1
       AND s.shared_quiz_id = $2
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [userId, sharedQuizId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
  };
}

export async function getSessionByUserAndShareSeed(userId, shareSeed) {
  const result = await db.query(
    `SELECT
       s.id, s.user_id, s.upload_id, s.shared_quiz_id, s.config, s.share_token, s.score, s.created_at,
       u.file_name AS upload_name,
       sq.token AS shared_quiz_token,
       sq.option_seed AS shared_quiz_option_seed
     FROM quiz_sessions s
     JOIN uploads u ON u.id = s.upload_id
     LEFT JOIN shared_quizzes sq ON sq.id = s.shared_quiz_id
     WHERE s.user_id = $1
       AND COALESCE(s.config->>'shareSeed', '') = $2
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [userId, shareSeed]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
  };
}

export async function getSessionsByUser(userId) {
  const result = await db.query(
    `SELECT
       s.id, s.user_id, s.upload_id, s.shared_quiz_id, s.config, s.share_token, s.score, s.created_at,
       u.file_name AS upload_name,
       u.file_type,
       sq.token AS shared_quiz_token
     FROM quiz_sessions s
     JOIN uploads u ON u.id = s.upload_id
     LEFT JOIN shared_quizzes sq ON sq.id = s.shared_quiz_id
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    ...row,
    config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
  }));
}

// ─── Update ────────────────────────────────────────────────────────────────────

export async function updateSessionScore(id, score) {
  const result = await db.query(
    `UPDATE quiz_sessions SET score = $1 WHERE id = $2
     RETURNING id, score`,
    [score, id]
  );
  return result.rows[0] ?? null;
}

export async function updateSessionSharedQuiz(id, sharedQuizId) {
  const result = await db.query(
    `UPDATE quiz_sessions
     SET shared_quiz_id = $1
     WHERE id = $2
     RETURNING id, shared_quiz_id`,
    [sharedQuizId, id]
  );
  return result.rows[0] ?? null;
}
