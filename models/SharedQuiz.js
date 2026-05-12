// SharedQuiz model — stable, shareable quiz templates

import db from '../config/db.js';

export async function createSharedQuiz({
  token,
  ownerUserId,
  uploadId,
  config = {},
  questionIds,
  optionSeed,
}) {
  const result = await db.query(
    `INSERT INTO shared_quizzes (token, owner_user_id, upload_id, config, question_ids, option_seed)
     VALUES ($1, $2, $3, $4::jsonb, $5::int[], $6)
     RETURNING id, token, owner_user_id, upload_id, config, question_ids, option_seed, created_at`,
    [token, ownerUserId ?? null, uploadId, JSON.stringify(config), questionIds, optionSeed]
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
  };
}

export async function getSharedQuizByToken(token) {
  const result = await db.query(
    `SELECT id, token, owner_user_id, upload_id, config, question_ids, option_seed, created_at
     FROM shared_quizzes
     WHERE token = $1`,
    [token]
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
  };
}

export async function getSharedQuizById(id) {
  const result = await db.query(
    `SELECT id, token, owner_user_id, upload_id, config, question_ids, option_seed, created_at
     FROM shared_quizzes
     WHERE id = $1`,
    [id]
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
  };
}
