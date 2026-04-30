// QuizSession model — tracks each quiz attempt by a user

import db from "../config/db.js";

// ─── Create ────────────────────────────────────────────────────────────────────

export async function createSession({ userId, uploadId, config = {} }) {
  const result = await db.query(
    `INSERT INTO quiz_sessions (user_id, upload_id, config)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, upload_id, config, score, created_at`,
    [userId, uploadId, JSON.stringify(config)]
  );
  return result.rows[0];
}

// ─── Read ──────────────────────────────────────────────────────────────────────

export async function getSessionById(id) {
  const result = await db.query(
    `SELECT
       s.id, s.user_id, s.upload_id, s.config, s.score, s.created_at,
       u.file_name AS upload_name
     FROM quiz_sessions s
     JOIN uploads u ON u.id = s.upload_id
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

export async function getSessionsByUser(userId) {
  const result = await db.query(
    `SELECT
       s.id, s.user_id, s.upload_id, s.config, s.score, s.created_at,
       u.file_name AS upload_name,
       u.file_type
     FROM quiz_sessions s
     JOIN uploads u ON u.id = s.upload_id
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
