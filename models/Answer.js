// Answer model — stores individual quiz answers for each session

import db from "../config/db.js";

// ─── Create ────────────────────────────────────────────────────────────────────

export async function saveAnswer({ sessionId, questionId, selectedAnswer, isCorrect }) {
  const result = await db.query(
    `INSERT INTO answers (session_id, question_id, selected_answer, is_correct)
     VALUES ($1, $2, $3, $4)
     RETURNING id, session_id, question_id, selected_answer, is_correct, created_at`,
    [sessionId, questionId, selectedAnswer, isCorrect]
  );
  return result.rows[0];
}

// ─── Read ──────────────────────────────────────────────────────────────────────

export async function getAnswersBySession(sessionId) {
  const result = await db.query(
    `SELECT id, session_id, question_id, selected_answer, is_correct, created_at
     FROM answers
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId]
  );
  return result.rows;
}

// ─── Delete ────────────────────────────────────────────────────────────────────

export async function deleteAnswersBySession(sessionId) {
  await db.query(
    `DELETE FROM answers WHERE session_id = $1`,
    [sessionId]
  );
}
